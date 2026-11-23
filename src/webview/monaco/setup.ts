/**
 * Monaco bootstrap shared by the ECUC editor and diff pages.
 *
 * The VS Code webview cannot load Monaco's default worker from a cross-origin
 * resource URI, so the worker source is fetched once and started from a blob.
 * The host passes the bundled worker URI through a meta tag in the shell.
 */
import * as monaco from 'monaco-editor';
import { toMonacoColor } from './colors';
import { tokenizeEcucLine } from './tokens';

type ThemeKind = 'dark' | 'light' | 'hc' | 'hc-light';

let workerReady: Promise<void> | undefined;
const foldingByModel = new WeakMap<monaco.editor.ITextModel, { startLine: number; endLine: number }[]>();
let foldingRegistered = false;

function registerFolding(): void {
	if (foldingRegistered) {
		return;
	}
	foldingRegistered = true;
	monaco.languages.registerFoldingRangeProvider('arxml-ecuc', {
		provideFoldingRanges(model) {
			const ranges = foldingByModel.get(model) ?? [];
			return ranges.map((range) => ({ start: range.startLine, end: range.endLine }));
		}
	});
}

/** Attach the synthetic document's container ranges to a Monaco model. */
export function setModelFolding(
	model: monaco.editor.ITextModel,
	ranges: { startLine: number; endLine: number }[]
): void {
	registerFolding();
	foldingByModel.set(model, ranges);
}

function readMeta(name: string): string | undefined {
	const meta = document.querySelector(`meta[name="${name}"]`);
	const value = meta?.getAttribute('content');
	return value !== undefined && value !== null && value !== '' ? value : undefined;
}

async function installEnvironment(): Promise<void> {
	const workerUri = readMeta('arxml-worker-uri');
	let workerUrl: string | undefined;
	if (workerUri !== undefined) {
		try {
			const response = await fetch(workerUri);
			if (response.ok) {
				const source = await response.text();
				workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
			}
		} catch {
			// Reported below; the editor can still render, but the diff worker is gone.
		}
	}
	if (workerUrl === undefined) {
		console.error('ARXML Scope: the Monaco worker asset did not load');
		workerUrl = URL.createObjectURL(new Blob(['self.onmessage = function () {};'], { type: 'text/javascript' }));
	}
	Object.assign(globalThis, {
		MonacoEnvironment: {
			getWorker(): Worker {
				return new Worker(workerUrl);
			}
		}
	});
}

export function ensureMonacoEnvironment(): Promise<void> {
	if (workerReady === undefined) {
		workerReady = installEnvironment();
	}
	return workerReady;
}

const TOKEN_STATE: monaco.languages.IState = {
	clone() {
		return TOKEN_STATE;
	},
	equals(other) {
		return other === TOKEN_STATE;
	}
};

function registerLanguage(): void {
	monaco.languages.register({ id: 'arxml-ecuc' });
	monaco.languages.setLanguageConfiguration('arxml-ecuc', {
		comments: { blockComment: ['/*', '*/'] },
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: []
	});
	monaco.languages.setTokensProvider('arxml-ecuc', {
		getInitialState() {
			return TOKEN_STATE;
		},
		tokenize(line, state) {
			return {
				tokens: tokenizeEcucLine(line).map((token) => ({
					startIndex: token.start,
					scopes: token.type
				})),
				endState: state
			};
		}
	});
}

registerLanguage();

function currentThemeKind(): ThemeKind {
	const body = document.body;
	if (body.classList.contains('vscode-high-contrast-light')) {
		return 'hc-light';
	}
	if (body.classList.contains('vscode-high-contrast')) {
		return 'hc';
	}
	if (body.classList.contains('vscode-light')) {
		return 'light';
	}
	return 'dark';
}

function css(name: string, fallback: string): string {
	const styles = getComputedStyle(document.documentElement);
	const value = styles.getPropertyValue(name).trim();
	if (value !== '') {
		return value;
	}
	const bodyValue = getComputedStyle(document.body).getPropertyValue(name).trim();
	return bodyValue !== '' ? bodyValue : fallback;
}

function toHex(value: string, fallback: string): string {
	return toMonacoColor(value, fallback);
}

function themeColors(): Record<string, string> {
	const kind = currentThemeKind();
	const dark = kind === 'dark' || kind === 'hc';
	const fallback = {
		background: dark ? '#1e1e1e' : '#ffffff',
		foreground: dark ? '#d4d4d4' : '#000000',
		lineNumber: dark ? '#858585' : '#237893',
		lineNumberActive: dark ? '#c6c6c6' : '#0b216f',
		selection: dark ? '#264f78' : '#add6ff',
		inactiveSelection: dark ? '#3a3d41' : '#e5ebf1',
		lineHighlight: dark ? '#2a2d2e' : '#f3f3f3',
		cursor: dark ? '#aeafad' : '#000000',
		widget: dark ? '#252526' : '#f3f3f3',
		widgetBorder: dark ? '#454545' : '#c8c8c8',
		input: dark ? '#3c3c3c' : '#ffffff',
		inputBorder: dark ? '#3c3c3c' : '#cecece',
		focus: dark ? '#007fd4' : '#0090f1',
		scrollbar: dark ? '#79797966' : '#64646466',
		scrollbarHover: dark ? '#646464b3' : '#646464b3'
	};
	const color = (name: string, fallbackValue: string): string =>
		toHex(css(name, fallbackValue), fallbackValue);
	return {
		'editor.background': color('--vscode-editor-background', fallback.background),
		'editor.foreground': color('--vscode-editor-foreground', fallback.foreground),
		'editorLineNumber.foreground': color('--vscode-editorLineNumber-foreground', fallback.lineNumber),
		'editorLineNumber.activeForeground': color(
			'--vscode-editorLineNumber-activeForeground',
			fallback.lineNumberActive
		),
		'editor.selectionBackground': color('--vscode-editor-selectionBackground', fallback.selection),
		'editor.inactiveSelectionBackground': color(
			'--vscode-editor-inactiveSelectionBackground',
			fallback.inactiveSelection
		),
		'editor.lineHighlightBackground': color(
			'--vscode-editor-lineHighlightBackground',
			fallback.lineHighlight
		),
		'editorCursor.foreground': color('--vscode-editorCursor-foreground', fallback.cursor),
		'editorWidget.background': color('--vscode-editorWidget-background', fallback.widget),
		'editorWidget.border': color('--vscode-editorWidget-border', fallback.widgetBorder),
		'input.background': color('--vscode-input-background', fallback.input),
		'input.border': color('--vscode-input-border', fallback.inputBorder),
		'focusBorder': color('--vscode-focusBorder', fallback.focus),
		'scrollbarSlider.background': color('--vscode-scrollbarSlider-background', fallback.scrollbar),
		'scrollbarSlider.hoverBackground': color(
			'--vscode-scrollbarSlider-hoverBackground',
			fallback.scrollbarHover
		),
		'scrollbarSlider.activeBackground': color(
			'--vscode-scrollbarSlider-activeBackground',
			fallback.scrollbarHover
		),
		'diffEditor.insertedLineBackground': color(
			'--vscode-diffEditor-insertedLineBackground',
			dark ? '#347d3926' : '#e2f7e2'
		),
		'diffEditor.removedLineBackground': color(
			'--vscode-diffEditor-removedLineBackground',
			dark ? '#c93c3726' : '#ffeaea'
		),
		'diffEditor.insertedTextBackground': color(
			'--vscode-diffEditor-insertedTextBackground',
			dark ? '#57ab5a4d' : '#587c0c26'
		),
		'diffEditor.removedTextBackground': color(
			'--vscode-diffEditor-removedTextBackground',
			dark ? '#f470674d' : '#ad070726'
		)
	};
}

function themeRules(): { token: string; foreground: string; fontStyle?: string }[] {
	const kind = currentThemeKind();
	if (kind === 'light' || kind === 'hc-light') {
		return [
			{ token: 'keyword', foreground: '0000ff' },
			{ token: 'type', foreground: '267f99' },
			{ token: 'variable', foreground: '001080' },
			{ token: 'function', foreground: '795e26', fontStyle: 'italic' },
			{ token: 'parameter', foreground: 'af00db' },
			{ token: 'namespace', foreground: '267f99' },
			{ token: 'string', foreground: 'a31515' },
			{ token: 'number', foreground: '098658' },
			{ token: 'number.hex', foreground: '098658' },
			{ token: 'comment', foreground: '008000', fontStyle: 'italic' },
			{ token: 'identifier', foreground: '001080' },
			{ token: 'delimiter', foreground: '000000' },
			{ token: 'operator', foreground: '000000' },
			// The condition palette: the preprocessor blue for names and the
			// constant cyan for literals. Operators reuse `parameter` above.
			{ token: 'syscond', foreground: '0000ff' },
			{ token: 'constant', foreground: '0070c1' }
		];
	}
	return [
		{ token: 'keyword', foreground: '569cd6' },
		{ token: 'type', foreground: '4ec9b0' },
		{ token: 'variable', foreground: '9cdcfe' },
		{ token: 'function', foreground: 'dcdcaa', fontStyle: 'italic' },
		{ token: 'parameter', foreground: 'c586c0' },
		{ token: 'namespace', foreground: '4ec9b0' },
		{ token: 'string', foreground: 'ce9178' },
		{ token: 'number', foreground: 'b5cea8' },
		{ token: 'number.hex', foreground: 'b5cea8' },
		{ token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
		{ token: 'identifier', foreground: '9cdcfe' },
		{ token: 'delimiter', foreground: '808080' },
		{ token: 'operator', foreground: 'd4d4d4' },
		// The condition palette: the preprocessor blue for names and the
		// constant cyan for literals. Operators reuse `parameter` above.
		{ token: 'syscond', foreground: '569cd6' },
		{ token: 'constant', foreground: '4fc1ff' }
	];
}

export function defineEcucTheme(): string {
	const kind = currentThemeKind();
	const base = kind === 'light'
		? 'vs'
		: kind === 'hc'
			? 'hc-black'
			: kind === 'hc-light'
				? 'hc-light'
				: 'vs-dark';
	monaco.editor.defineTheme('arxml-ecuc-theme', {
		base,
		inherit: true,
		rules: themeRules(),
		colors: themeColors()
	});
	return 'arxml-ecuc-theme';
}

function editorFontOptions(): {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	fontWeight: string;
} {
	const family = css('--vscode-editor-font-family', "'Consolas', 'Courier New', monospace");
	const sizeText = css('--vscode-editor-font-size', '14px');
	const size = Number.parseFloat(sizeText.replace('px', ''));
	const heightText = css('--vscode-editor-line-height', '0');
	const height = Number.parseFloat(heightText.replace('px', ''));
	return {
		fontFamily: family,
		fontSize: Number.isFinite(size) && size > 0 ? size : 14,
		lineHeight: Number.isFinite(height) && height > 0 ? height : 0,
		fontWeight: css('--vscode-editor-font-weight', 'normal')
	};
}

export function createEcucEditor(container: HTMLElement, model: monaco.editor.ITextModel): monaco.editor.IStandaloneCodeEditor {
	const font = editorFontOptions();
	return monaco.editor.create(container, {
		model,
		theme: defineEcucTheme(),
		automaticLayout: true,
		readOnly: false,
		domReadOnly: false,
		lineNumbers: 'on',
		lineNumbersMinChars: 3,
		glyphMargin: false,
		folding: true,
		showFoldingControls: 'mouseover',
		minimap: { enabled: true },
		stickyScroll: { enabled: true, defaultModel: 'foldingProviderModel' },
		guides: { indentation: true, bracketPairs: false, highlightActiveBracketPair: true },
		bracketPairColorization: { enabled: true },
		wordWrap: 'off',
		scrollBeyondLastLine: false,
		smoothScrolling: true,
		renderWhitespace: 'selection',
		renderLineHighlight: 'all',
		overviewRulerLanes: 2,
		cursorBlinking: 'blink',
		contextmenu: true,
		fontFamily: font.fontFamily,
		fontSize: font.fontSize,
		fontWeight: font.fontWeight,
		...(font.lineHeight > 0 ? { lineHeight: font.lineHeight } : {}),
		scrollbar: {
			verticalScrollbarSize: 14,
			horizontalScrollbarSize: 12,
			useShadows: false
		}
	});
}

export { monaco };
