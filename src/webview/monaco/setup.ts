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

async function fetchWorkerUrl(workerUri: string): Promise<string | undefined> {
	try {
		const response = await fetch(workerUri);
		if (!response.ok) {
			return undefined;
		}
		const source = await response.text();
		return workerBlobUrl(source);
	} catch {
		// Reported below; the editor can still render, but the diff worker is gone.
		return undefined;
	}
}

function workerBlobUrl(source: string): string {
	return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}

async function resolveWorkerUrl(): Promise<string> {
	const workerUri = readMeta('arxml-worker-uri');
	const workerUrl = workerUri === undefined ? undefined : await fetchWorkerUrl(workerUri);
	if (workerUrl !== undefined) {
		return workerUrl;
	}
	console.error('ARXML Scope: the Monaco worker asset did not load');
	return workerBlobUrl('self.onmessage = function () {};');
}

async function installEnvironment(): Promise<void> {
	const workerUrl = await resolveWorkerUrl();
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

interface ThemeFallbacks {
	background: string;
	foreground: string;
	lineNumber: string;
	lineNumberActive: string;
	selection: string;
	inactiveSelection: string;
	lineHighlight: string;
	cursor: string;
	widget: string;
	widgetBorder: string;
	input: string;
	inputBorder: string;
	focus: string;
	scrollbar: string;
	scrollbarHover: string;
	insertedLine: string;
	removedLine: string;
	insertedText: string;
	removedText: string;
}

const DARK_FALLBACKS: ThemeFallbacks = {
	background: '#1e1e1e',
	foreground: '#d4d4d4',
	lineNumber: '#858585',
	lineNumberActive: '#c6c6c6',
	selection: '#264f78',
	inactiveSelection: '#3a3d41',
	lineHighlight: '#2a2d2e',
	cursor: '#aeafad',
	widget: '#252526',
	widgetBorder: '#454545',
	input: '#3c3c3c',
	inputBorder: '#3c3c3c',
	focus: '#007fd4',
	scrollbar: '#79797966',
	scrollbarHover: '#646464b3',
	insertedLine: '#347d3926',
	removedLine: '#c93c3726',
	insertedText: '#57ab5a4d',
	removedText: '#f470674d'
};

const LIGHT_FALLBACKS: ThemeFallbacks = {
	background: '#ffffff',
	foreground: '#000000',
	lineNumber: '#237893',
	lineNumberActive: '#0b216f',
	selection: '#add6ff',
	inactiveSelection: '#e5ebf1',
	lineHighlight: '#f3f3f3',
	cursor: '#000000',
	widget: '#f3f3f3',
	widgetBorder: '#c8c8c8',
	input: '#ffffff',
	inputBorder: '#cecece',
	focus: '#0090f1',
	scrollbar: '#64646466',
	scrollbarHover: '#646464b3',
	insertedLine: '#e2f7e2',
	removedLine: '#ffeaea',
	insertedText: '#587c0c26',
	removedText: '#ad070726'
};

type FallbackSlot = keyof ThemeFallbacks;

/** Theme color key, CSS variable, and the fallback used when the variable is absent. */
const THEME_COLOR_RULES: readonly (readonly [string, string, FallbackSlot])[] = [
	['editor.background', '--vscode-editor-background', 'background'],
	['editor.foreground', '--vscode-editor-foreground', 'foreground'],
	['editorLineNumber.foreground', '--vscode-editorLineNumber-foreground', 'lineNumber'],
	['editorLineNumber.activeForeground', '--vscode-editorLineNumber-activeForeground', 'lineNumberActive'],
	['editor.selectionBackground', '--vscode-editor-selectionBackground', 'selection'],
	['editor.inactiveSelectionBackground', '--vscode-editor-inactiveSelectionBackground', 'inactiveSelection'],
	['editor.lineHighlightBackground', '--vscode-editor-lineHighlightBackground', 'lineHighlight'],
	['editorCursor.foreground', '--vscode-editorCursor-foreground', 'cursor'],
	['editorWidget.background', '--vscode-editorWidget-background', 'widget'],
	['editorWidget.border', '--vscode-editorWidget-border', 'widgetBorder'],
	['input.background', '--vscode-input-background', 'input'],
	['input.border', '--vscode-input-border', 'inputBorder'],
	['focusBorder', '--vscode-focusBorder', 'focus'],
	['scrollbarSlider.background', '--vscode-scrollbarSlider-background', 'scrollbar'],
	['scrollbarSlider.hoverBackground', '--vscode-scrollbarSlider-hoverBackground', 'scrollbarHover'],
	['scrollbarSlider.activeBackground', '--vscode-scrollbarSlider-activeBackground', 'scrollbarHover'],
	['diffEditor.insertedLineBackground', '--vscode-diffEditor-insertedLineBackground', 'insertedLine'],
	['diffEditor.removedLineBackground', '--vscode-diffEditor-removedLineBackground', 'removedLine'],
	['diffEditor.insertedTextBackground', '--vscode-diffEditor-insertedTextBackground', 'insertedText'],
	['diffEditor.removedTextBackground', '--vscode-diffEditor-removedTextBackground', 'removedText']
];

function fallbacksFor(kind: ThemeKind): ThemeFallbacks {
	return kind === 'dark' || kind === 'hc' ? DARK_FALLBACKS : LIGHT_FALLBACKS;
}

function themeColors(): Record<string, string> {
	const fallback = fallbacksFor(currentThemeKind());
	const colors: Record<string, string> = {};
	for (const [key, variable, slot] of THEME_COLOR_RULES) {
		const fallbackValue = fallback[slot];
		colors[key] = toHex(css(variable, fallbackValue), fallbackValue);
	}
	return colors;
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

function positiveNumber(text: string, fallback: number): number {
	const parsed = Number.parseFloat(text.replace('px', ''));
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return parsed > 0 ? parsed : fallback;
}

export function editorFontOptions(): {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	fontWeight: string;
} {
	return {
		fontFamily: css('--vscode-editor-font-family', "'Consolas', 'Courier New', monospace"),
		fontSize: positiveNumber(css('--vscode-editor-font-size', '14px'), 14),
		lineHeight: positiveNumber(css('--vscode-editor-line-height', '0'), 0),
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
