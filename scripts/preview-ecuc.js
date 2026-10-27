#!/usr/bin/env node
/**
 * Local preview harness for the ECUC webview (task 10-27-ecuc-editor-visual-polish).
 *
 * It serves the **production** `renderHtml` output over 127.0.0.1 with a stubbed
 * `acquireVsCodeApi`, a theme preset, a simulated host and a small preview panel. It is
 * a development tool: it lives outside `src/`, is never imported by the extension, and
 * adds no runtime dependency.
 *
 *   npm run preview:ecuc     compile the sources, then serve http://127.0.0.1:4173/
 *   npm run preview:check    render every fixture x theme and hit the server; no browser
 *
 * The page's CSP is `default-src 'none'`; every injected style/script carries the same
 * nonce the page was rendered with. There are no inline event handlers.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const { ROOT, outModule } = require('./out-module');
const FIXTURE_ROOT = path.join(ROOT, 'src', 'test', 'fixtures');
// Optional local sample set, outside the repository. `preview:ecuc` lists it when it exists;
// `preview:check` never does, so CI does not depend on a developer's sample directory.
const SAMPLE_ROOT = process.env.PREVIEW_SAMPLE_DIR || path.resolve(ROOT, '..', 'sample');
const DEFAULT_PORT = 4173;
const NONCE = 'preview-nonce';

const THEME_ORDER = ['light', 'dark', 'hc'];

const THEMES = {
	light: {
		id: 'light',
		label: 'Light+',
		colorScheme: 'light',
		vars: {
			'foreground': '#333333',
			'editor-background': '#ffffff',
			'sideBar-background': '#f3f3f3',
			'editorWidget-background': '#f3f3f3',
			'editorWidget-border': '#c8c8c8',
			'descriptionForeground': '#717171',
			'panel-border': '#e5e5e5',
			'list-hoverBackground': '#f0f0f0',
			'list-focusBackground': '#e4e6f1',
			'list-activeSelectionBackground': '#0060c0',
			'list-activeSelectionForeground': '#ffffff',
			'list-inactiveSelectionBackground': '#e4e6f1',
			'list-inactiveSelectionForeground': '#333333',
			'focusBorder': '#0090f1',
			'input-background': '#ffffff',
			'input-foreground': '#333333',
			'input-border': '#cecece',
			'button-background': '#007acc',
			'button-foreground': '#ffffff',
			'button-secondaryBackground': '#f3f3f3',
			'button-secondaryForeground': '#333333',
			'button-secondaryHoverBackground': '#e8e8e8',
			'button-border': '#cecece',
			'icon-foreground': '#424242',
			'symbolIcon-classForeground': '#b1801a',
			'symbolIcon-moduleForeground': '#795e26',
			'symbolIcon-functionForeground': '#795e26',
			'symbolIcon-namespaceForeground': '#267f99',
			'symbolIcon-variableForeground': '#0070c1',
			'symbolIcon-booleanForeground': '#0000ff',
			'symbolIcon-fieldForeground': '#0070c1',
			'symbolIcon-referenceForeground': '#0070c1',
			'symbolIcon-stringForeground': '#a31515',
			'symbolIcon-enumeratorForeground': '#267f99',
			'symbolIcon-keywordForeground': '#0000ff',
			'symbolIcon-numberForeground': '#098658',
			'debugTokenExpression-boolean': '#0000ff',
			'debugTokenExpression-string': '#a31515',
			'debugTokenExpression-number': '#098658',
			'debugTokenExpression-name': '#af00db',
			'charts-green': '#388a34',
			'tree-indentGuidesStroke': '#d3d3d3',
			'editor-findMatchHighlightBackground': '#ea5c0055',
			'editor-findMatchForeground': '#000000',
			'editorLineNumber-foreground': '#237893',
			'editorLineNumber-activeForeground': '#0b216f',
			'editorWarning-foreground': '#bf8803',
			'inputValidation-warningBackground': '#fff4d1',
			'inputValidation-warningBorder': '#bf8803',
			'editorError-foreground': '#a1260d',
			'errorForeground': '#a1260d',
			'badge-background': '#c4c4c4',
			'badge-foreground': '#333333',
			'textLink-foreground': '#006ab1',
			'font-family': '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
			'font-size': '13px',
			'editor-font-family': 'Consolas, "Courier New", monospace',
		},
	},
	dark: {
		id: 'dark',
		label: 'Dark+',
		colorScheme: 'dark',
		vars: {
			'foreground': '#cccccc',
			'editor-background': '#1e1e1e',
			'sideBar-background': '#252526',
			'editorWidget-background': '#252526',
			'editorWidget-border': '#454545',
			'descriptionForeground': '#9d9d9d',
			'panel-border': '#3c3c3c',
			'list-hoverBackground': '#2a2d2e',
			'list-focusBackground': '#04395e',
			'list-activeSelectionBackground': '#04395e',
			'list-activeSelectionForeground': '#ffffff',
			'list-inactiveSelectionBackground': '#37373d',
			'list-inactiveSelectionForeground': '#cccccc',
			'focusBorder': '#007acc',
			'input-background': '#3c3c3c',
			'input-foreground': '#cccccc',
			'input-border': '#3c3c3c',
			'button-background': '#0e639c',
			'button-foreground': '#ffffff',
			'button-secondaryBackground': '#3a3d41',
			'button-secondaryForeground': '#cccccc',
			'button-secondaryHoverBackground': '#45494e',
			'button-border': '#00000000',
			'icon-foreground': '#c5c5c5',
			'symbolIcon-classForeground': '#ee9d28',
			'symbolIcon-moduleForeground': '#e37933',
			'symbolIcon-functionForeground': '#dcdcaa',
			'symbolIcon-namespaceForeground': '#4ec9b0',
			'symbolIcon-variableForeground': '#75beff',
			'symbolIcon-booleanForeground': '#569cd6',
			'symbolIcon-fieldForeground': '#75beff',
			'symbolIcon-referenceForeground': '#4fc1ff',
			'symbolIcon-stringForeground': '#ce9178',
			'symbolIcon-enumeratorForeground': '#b8d7a3',
			'symbolIcon-keywordForeground': '#569cd6',
			'symbolIcon-numberForeground': '#b5cea8',
			'debugTokenExpression-boolean': '#569cd6',
			'debugTokenExpression-string': '#ce9178',
			'debugTokenExpression-number': '#b5cea8',
			'debugTokenExpression-name': '#c586c0',
			'charts-green': '#89d185',
			'tree-indentGuidesStroke': '#404040',
			'editor-findMatchHighlightBackground': '#ea5c0055',
			'editor-findMatchForeground': '#ffffff',
			'editorLineNumber-foreground': '#858585',
			'editorLineNumber-activeForeground': '#c6c6c6',
			'editorWarning-foreground': '#cca700',
			'inputValidation-warningBackground': '#352a05',
			'inputValidation-warningBorder': '#cca700',
			'editorError-foreground': '#f48771',
			'errorForeground': '#f48771',
			'badge-background': '#4d4d4d',
			'badge-foreground': '#ffffff',
			'textLink-foreground': '#3794ff',
			'font-family': '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
			'font-size': '13px',
			'editor-font-family': 'Consolas, "Courier New", monospace',
		},
	},
	hc: {
		id: 'hc',
		label: 'High Contrast',
		colorScheme: 'dark',
		vars: {
			'foreground': '#ffffff',
			'editor-background': '#000000',
			'sideBar-background': '#000000',
			'editorWidget-background': '#000000',
			'editorWidget-border': '#6fc3df',
			'descriptionForeground': '#ffffff',
			'panel-border': '#6fc3df',
			'list-hoverBackground': '#1a1a1a',
			'list-focusBackground': '#000000',
			'list-activeSelectionBackground': '#000000',
			'list-activeSelectionForeground': '#ffffff',
			'list-inactiveSelectionBackground': '#000000',
			'list-inactiveSelectionForeground': '#ffffff',
			'focusBorder': '#f38518',
			'input-background': '#000000',
			'input-foreground': '#ffffff',
			'input-border': '#6fc3df',
			'button-background': '#000000',
			'button-foreground': '#ffffff',
			'button-secondaryBackground': '#000000',
			'button-secondaryForeground': '#ffffff',
			'button-secondaryHoverBackground': '#1a1a1a',
			'button-border': '#6fc3df',
			'icon-foreground': '#ffffff',
			'symbolIcon-classForeground': '#ffffff',
			'symbolIcon-moduleForeground': '#ffffff',
			'symbolIcon-functionForeground': '#ffffff',
			'symbolIcon-namespaceForeground': '#ffffff',
			'symbolIcon-variableForeground': '#ffffff',
			'symbolIcon-booleanForeground': '#ffffff',
			'symbolIcon-fieldForeground': '#ffffff',
			'symbolIcon-referenceForeground': '#ffffff',
			'symbolIcon-stringForeground': '#ffffff',
			'symbolIcon-enumeratorForeground': '#ffffff',
			'symbolIcon-keywordForeground': '#ffffff',
			'symbolIcon-numberForeground': '#ffffff',
			'debugTokenExpression-boolean': '#ffffff',
			'debugTokenExpression-string': '#ffffff',
			'debugTokenExpression-number': '#ffffff',
			'debugTokenExpression-name': '#ffffff',
			'charts-green': '#ffffff',
			'tree-indentGuidesStroke': '#ffffff',
			'editor-findMatchHighlightBackground': '#f38518',
			'editor-findMatchForeground': '#000000',
			'editorLineNumber-foreground': '#ffffff',
			'editorLineNumber-activeForeground': '#ffffff',
			'editorWarning-foreground': '#f38518',
			'inputValidation-warningBackground': '#000000',
			'inputValidation-warningBorder': '#f38518',
			'editorError-foreground': '#f48771',
			'errorForeground': '#f48771',
			'badge-background': '#000000',
			'badge-foreground': '#ffffff',
			'textLink-foreground': '#3794ff',
			'contrastActiveBorder': '#f38518',
			'contrastBorder': '#6fc3df',
			'font-family': '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
			'font-size': '13px',
			'editor-font-family': 'Consolas, "Courier New", monospace',
		},
	},
};

let scanner;
let renderer;
let offsets;

function loadProduction() {
	scanner = outModule(path.join('core', 'ecuc', 'scanner.js'));
	renderer = outModule(path.join('editor', 'renderHtml.js'));
	offsets = outModule(path.join('core', 'text', 'offsets.js'));
}

function escapeAttr(text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function discoverFixtures(options = {}) {
	const fixtures = [];
	const walk = (baseDir, prefix) => {
		for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
			const full = path.join(baseDir, entry.name);
			if (entry.isDirectory()) {
				walk(full, prefix + entry.name + '/');
				continue;
			}
			if (!entry.name.endsWith('.arxml') || entry.name.includes('.expected.')) {
				continue;
			}
			const id = (prefix + path.relative(baseDir, full)).split(path.sep).join('/').replace(/\.arxml$/, '');
			let text;
			try {
				text = fs.readFileSync(full, 'utf8');
			} catch {
				continue;
			}
			let model;
			try {
				model = scanner.scanEcucValues(text);
			} catch {
				continue;
			}
			if (!model.modules.length) {
				continue;
			}
			fixtures.push({ id, path: full, text, model });
		}
	};
	walk(FIXTURE_ROOT, '');
	if (options.includeSamples === true && fs.existsSync(SAMPLE_ROOT)) {
		walk(SAMPLE_ROOT, 'sample/');
	}
	return fixtures.sort((a, b) => a.id.localeCompare(b.id));
}

/** Resolve a query value against the whitelist; never treat it as a path. */
function resolveFixture(fixtures, requested) {
	if (!requested) {
		return fixtures.find((fixture) => fixture.id === 'editor/render') ?? fixtures[0];
	}
	const wanted = String(requested).replace(/\\/g, '/').replace(/\.arxml$/, '');
	return (
		fixtures.find((fixture) => fixture.id === wanted) ??
		fixtures.find((fixture) => fixture.id.endsWith('/' + wanted)) ??
		fixtures.find((fixture) => fixture.id === 'editor/' + wanted)
	);
}

/* -------------------------------------------------------------------------- */
/* Theme + preview page wrapper                                                */
/* -------------------------------------------------------------------------- */

function themeCss(theme) {
	const vars = Object.entries(theme.vars)
		.map(([name, value]) => `\t--vscode-${name}: ${value};`)
		.join('\n');
	return `:root {\n\tcolor-scheme: ${theme.colorScheme};\n${vars}\n}\n`;
}

const PREVIEW_CSS = `
#preview-panel {
	position: fixed;
	right: 12px;
	bottom: 12px;
	z-index: 1000;
	width: min(390px, calc(100vw - 24px));
	max-height: 48vh;
	display: flex;
	flex-direction: column;
	font-family: var(--vscode-editor-font-family, Consolas, monospace);
	font-size: 11px;
	line-height: 1.4;
	color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
	background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
	border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
	box-shadow: 0 2px 12px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
}
#preview-panel[data-collapsed="true"] .preview-body { display: none; }
.preview-head {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 5px 8px;
	border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
}
.preview-badge {
	padding: 0 5px;
	font-weight: 700;
	letter-spacing: 0.08em;
	color: var(--vscode-badge-foreground, var(--vscode-editor-background));
	background: var(--vscode-badge-background, var(--vscode-foreground));
}
.preview-title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-theme { color: var(--vscode-descriptionForeground); white-space: nowrap; }
.preview-body { padding: 8px; overflow: auto; }
.preview-field { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.preview-field select {
	flex: 1 1 auto;
	min-width: 0;
	font: inherit;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
}
.preview-actions { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.preview-button {
	padding: 1px 6px;
	font: inherit;
	cursor: pointer;
	color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
	background: var(--vscode-button-secondaryBackground, transparent);
	border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
}
.preview-button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
.preview-button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.preview-log {
	max-height: 150px;
	margin: 0;
	padding: 4px;
	overflow: auto;
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--vscode-descriptionForeground);
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-panel-border);
}
@media (max-width: 700px) {
	#preview-panel { left: 12px; right: 12px; width: auto; }
}
`;

const STUB_JS = `
(function () {
	var messages = [];
	var stateKey = 'ecuc-preview-state';
	var state = window.__previewInitialState || null;
	if (!state) {
		try {
			state = JSON.parse(window.localStorage.getItem(stateKey) || '{}') || {};
		} catch (error) {
			state = {};
		}
	}
	function stamp() { return new Date().toISOString().slice(11, 19); }
	function record(direction, message) {
		messages.push({ direction: direction, at: stamp(), message: message });
		if (window.__previewRenderLog) { window.__previewRenderLog(); }
	}
	var api = {
		postMessage: function (message) {
			record('to-host', message);
			if (message && message.type === 'copy' && navigator.clipboard && navigator.clipboard.writeText) {
				try {
					navigator.clipboard.writeText(String(message.text == null ? '' : message.text)).catch(function () {});
				} catch (error) { /* the log remains the evidence */ }
			}
			return true;
		},
		getState: function () { return state; },
		setState: function (next) {
			state = next || {};
			try {
				window.localStorage.setItem(stateKey, JSON.stringify(state));
			} catch (error) { /* the in-memory state still works */ }
			return state;
		}
	};
	window.acquireVsCodeApi = function () { return api; };
	window.__preview = {
		messages: messages,
		api: api,
		hostMessage: function (message) {
			record('to-page', message);
			window.postMessage(message, '*');
		}
	};
})();
`;

const PANEL_JS = `
(function () {
	var preview = window.__preview;
	var panel = document.getElementById('preview-panel');
	var log = document.getElementById('preview-log');
	var toggle = document.getElementById('preview-toggle');
	var fixture = document.getElementById('preview-fixture');
	var theme = document.getElementById('preview-theme');
	var sort = document.getElementById('preview-sort');

	function go(changes) {
		var url = new URL(window.location.href);
		Object.keys(changes).forEach(function (key) { url.searchParams.set(key, changes[key]); });
		window.location.href = url.toString();
	}
	fixture.addEventListener('change', function () { go({ fixture: fixture.value }); });
	theme.addEventListener('change', function () { go({ theme: theme.value }); });
	sort.addEventListener('change', function () { go({ sort: sort.value }); });

	function main() { return document.getElementById('main'); }
	function currentSelection() {
		var selected = document.querySelector('#tree [aria-selected="true"]');
		return selected ? selected.getAttribute('data-node-id') : undefined;
	}
	function rescan() {
		preview.hostMessage({ type: 'model', tree: main().innerHTML, selectedId: currentSelection() });
	}
	function rescanChanged() {
		var clone = main().cloneNode(true);
		var item = clone.querySelector('[data-kind="parameter"]');
		if (!item) {
			preview.hostMessage({ type: 'notice', message: 'No parameter to change in this fixture.', kind: 'warn' });
			return;
		}
		var value = item.querySelector(':scope > .row > .value');
		if (!value) {
			preview.hostMessage({ type: 'notice', message: 'The first parameter has no value span.', kind: 'warn' });
			return;
		}
		var before = value.textContent;
		var after = before.replace(/(-?\\d+)/, function (match) { return String(Number(match) + 1); });
		if (after === before) { after = before + ' '; }
		value.textContent = after;
		value.title = 'Simulated re-scan value (was ' + before + ')';
		preview.hostMessage({ type: 'model', tree: clone.innerHTML, selectedId: currentSelection() });
		preview.hostMessage({ type: 'notice', message: 'Simulated a document change (value only).', kind: 'info' });
	}
	function notice(kind, text) {
		preview.hostMessage({ type: 'notice', message: text, kind: kind });
	}
	document.getElementById('preview-rescan').addEventListener('click', rescan);
	document.getElementById('preview-rescan-change').addEventListener('click', rescanChanged);
	document.getElementById('preview-notice-info').addEventListener('click', function () { notice('info', 'Preview info notice.'); });
	document.getElementById('preview-notice-warn').addEventListener('click', function () { notice('warn', 'Preview warning notice.'); });
	document.getElementById('preview-clear-log').addEventListener('click', function () {
		preview.messages.length = 0;
		renderLog();
	});
	toggle.addEventListener('click', function () {
		var collapsed = panel.getAttribute('data-collapsed') === 'true';
		panel.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
		toggle.textContent = collapsed ? 'Hide' : 'Show';
		toggle.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
	});
	function renderLog() {
		var lines = preview.messages.map(function (entry) {
			var text;
			try { text = JSON.stringify(entry.message); } catch (error) { text = String(entry.message); }
			if (text.length > 260) { text = text.slice(0, 257) + '...'; }
			return entry.at + ' ' + (entry.direction === 'to-host' ? '-> ' : '<- ') + text;
		});
		log.textContent = lines.join('\\n');
		log.scrollTop = log.scrollHeight;
	}
	window.__previewRenderLog = renderLog;
	renderLog();
})();
`;

function options(values, selected) {
	return values
		.map((value) => `<option value="${escapeAttr(value)}"${value === selected ? ' selected' : ''}>${escapeAttr(value)}</option>`)
		.join('');
}

function panelHtml(ctx) {
	return `
<div id="preview-panel" data-collapsed="false">
	<div class="preview-head">
		<span class="preview-badge">PREVIEW</span>
		<span class="preview-title">${escapeAttr(ctx.fixture.id)}</span>
		<span class="preview-theme">${escapeAttr(ctx.theme.label)}</span>
		<button id="preview-toggle" class="preview-button" type="button" aria-expanded="true">Hide</button>
	</div>
	<div class="preview-body">
		<label class="preview-field">Fixture <select id="preview-fixture">${options(
			ctx.fixtures.map((fixture) => fixture.id),
			ctx.fixture.id
		)}</select></label>
		<label class="preview-field">Theme <select id="preview-theme">${options(
			THEME_ORDER,
			ctx.theme.id
		)}</select></label>
		<label class="preview-field">Sort <select id="preview-sort">${options(
			['all', 'declaration'],
			ctx.sort
		)}</select></label>
		<div class="preview-actions">
			<button id="preview-rescan" class="preview-button" type="button" title="Deliver the current tree back as a host model message">Re-scan</button>
			<button id="preview-rescan-change" class="preview-button" type="button" title="Deliver a tree with the first parameter's text changed">Re-scan + value</button>
			<button id="preview-notice-info" class="preview-button" type="button">Info notice</button>
			<button id="preview-notice-warn" class="preview-button" type="button">Warn notice</button>
			<button id="preview-clear-log" class="preview-button" type="button">Clear log</button>
		</div>
		<pre id="preview-log" class="preview-log" aria-label="Webview message log"></pre>
	</div>
</div>`;
}

function wrap(html, ctx) {
	const initialState = ctx.view
		? `<script nonce="${NONCE}">window.__previewInitialState = ${JSON.stringify({
				view: ctx.view,
				inspectorHidden: true,
			})};</script>`
		: '';
	const head = [
		`<style nonce="${NONCE}">`,
		themeCss(ctx.theme),
		PREVIEW_CSS,
		'</style>',
		initialState,
		`<script nonce="${NONCE}">`,
		STUB_JS,
		'</script>',
	].join('\n');
	let page = html.replace('<html lang="en">', `<html lang="en" data-preview-theme="${ctx.theme.id}">`);
	const themeClass = ctx.theme.id === 'dark' ? 'vscode-dark' : ctx.theme.id === 'light' ? 'vscode-light' : 'vscode-high-contrast';
	page = page.replace('<body data-view="document">', `<body data-view="document" class="${themeClass}">`);
	page = page.replace('</head>', head + '\n</head>');
	if (ctx.chrome) {
		page = page.replace(
			'</body>',
			panelHtml(ctx) + `\n<script nonce="${NONCE}">${PANEL_JS}</script>\n</body>`
		);
	}
	return page;
}

function buildPage(fixture, options, fixtures) {
	if (!offsets) {
		loadProduction();
	}
	const html = renderer.renderHtml(fixture.model, {
		nonce: NONCE,
		sort: options.sort,
		lineIndex: new offsets.LineIndex(fixture.text),
	});
	return wrap(html, {
		fixture,
		fixtures,
		theme: THEMES[options.theme],
		sort: options.sort,
		chrome: options.chrome,
		view: options.view,
	});
}

/* -------------------------------------------------------------------------- */
/* HTTP server                                                                 */
/* -------------------------------------------------------------------------- */

function readOptions(url) {
	const theme = url.searchParams.get('theme') ?? 'dark';
	if (!THEMES[theme]) {
		const error = new Error('Unknown theme. Use one of: ' + THEME_ORDER.join(', '));
		error.status = 400;
		throw error;
	}
	const sort = url.searchParams.get('sort') === 'declaration' ? 'declaration' : 'all';
	const chrome = url.searchParams.get('chrome') !== '0';
	const viewParam = url.searchParams.get('view');
	const view = viewParam === 'tree' || viewParam === 'document' ? viewParam : undefined;
	return { theme, sort, chrome, view };
}

function send(res, status, body, type) {
	res.writeHead(status, {
		'Content-Type': type ?? 'text/plain; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	res.end(body);
}

function createServer(fixtures) {
	return http.createServer((req, res) => {
		let url;
		try {
			url = new URL(req.url ?? '/', 'http://127.0.0.1');
		} catch {
			send(res, 400, 'Bad request URL');
			return;
		}
		if (url.pathname === '/health') {
			send(res, 200, 'ok');
			return;
		}
		if (url.pathname !== '/' && url.pathname !== '/preview') {
			send(res, 404, 'Not found. Use / or /preview.');
			return;
		}
		let previewOptions;
		try {
			previewOptions = readOptions(url);
		} catch (error) {
			send(res, error.status ?? 500, error.message);
			return;
		}
		const fixture = resolveFixture(fixtures, url.searchParams.get('fixture'));
		if (!fixture) {
			send(
				res,
				400,
				'Unknown fixture. Known fixtures:\n' + fixtures.map((entry) => entry.id).join('\n')
			);
			return;
		}
		try {
			const started = performance.now();
			const page = buildPage(fixture, previewOptions, fixtures);
			const elapsed = performance.now() - started;
			console.log(
				'preview: ' +
					fixture.id +
					' / ' +
					previewOptions.theme +
					' built in ' +
					elapsed.toFixed(1) +
					' ms, ' +
					page.length +
					' chars'
			);
			send(res, 200, page, 'text/html; charset=utf-8');
		} catch (error) {
			send(res, 500, 'Preview failed: ' + (error && error.stack ? error.stack : String(error)));
		}
	});
}

function listen(server, port) {
	return new Promise((resolve, reject) => {
		const attempt = (candidate, remaining) => {
			const onError = (error) => {
				server.removeListener('error', onError);
				if (error.code === 'EADDRINUSE' && remaining > 0) {
					attempt(candidate + 1, remaining - 1);
				} else {
					reject(error);
				}
			};
			server.once('error', onError);
			server.listen(candidate, '127.0.0.1', () => {
				server.removeListener('error', onError);
				resolve(server.address().port);
			});
		};
		attempt(port, 10);
	});
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                                */
/* -------------------------------------------------------------------------- */

async function startPreview() {
	loadProduction();
	const fixtures = discoverFixtures({ includeSamples: true });
	if (fixtures.length === 0) {
		throw new Error('No ECUC fixtures found under ' + FIXTURE_ROOT);
	}
	const server = createServer(fixtures);
	const requested = Number(process.env.PREVIEW_PORT ?? DEFAULT_PORT);
	const port = await listen(server, Number.isFinite(requested) ? requested : DEFAULT_PORT);
	console.log('ECUC preview: http://127.0.0.1:' + port + '/');
	console.log('Fixtures: ' + fixtures.length + ' (default editor/render); themes: ' + THEME_ORDER.join(', '));
	if (fs.existsSync(SAMPLE_ROOT)) {
		console.log('Local samples: ' + SAMPLE_ROOT + ' (listed as sample/<name>)');
	}
	console.log('Add ?chrome=0 for a clean page. Stop with Ctrl+C.');
}

async function runCheck() {
	loadProduction();
	const fixtures = discoverFixtures({ includeSamples: false });
	if (fixtures.length === 0) {
		throw new Error('No ECUC fixtures found under ' + FIXTURE_ROOT);
	}
	let failures = 0;
	const check = (label, ok, detail) => {
		if (ok) {
			console.log('ok   ' + label);
		} else {
			failures++;
			console.log('FAIL ' + label + (detail ? ': ' + detail : ''));
		}
	};

	// The exact region the provider would swap in: the wrapper must not alter it.
	const treeFor = (fixture) =>
		renderer.renderTree(fixture.model, {
			sort: 'all',
			lineIndex: new offsets.LineIndex(fixture.text),
		});

	for (const fixture of fixtures) {
		const expectedTree = treeFor(fixture);
		for (const theme of THEME_ORDER) {
			try {
				const page = buildPage(fixture, { theme, sort: 'all', chrome: true }, fixtures);
				const themeClass =
					theme === 'light' ? 'vscode-light' : theme === 'dark' ? 'vscode-dark' : 'vscode-high-contrast';
				const ok =
					page.includes('data-preview-theme="' + theme + '"') &&
					page.includes('class="' + themeClass + '"') &&
					page.includes('--vscode-editor-background: ' + THEMES[theme].vars['editor-background']) &&
					page.includes(
						'--vscode-debugTokenExpression-string: ' + THEMES[theme].vars['debugTokenExpression-string']
					) &&
					page.includes(
						'--vscode-editorLineNumber-activeForeground: ' +
							THEMES[theme].vars['editorLineNumber-activeForeground']
					) &&
					page.includes(expectedTree) &&
					page.includes('role="treeitem"') &&
					page.includes('id="inspector"') &&
					page.includes('id="empty"') &&
					page.includes('window.__preview') &&
					page.includes('id="preview-panel"') &&
					!expectedTree.includes('undefined');
				check(
					fixture.id + ' / ' + theme,
					ok,
					ok ? '' : 'missing production tree, stub, theme class/tokens, inspector or empty state'
				);
			} catch (error) {
				check(fixture.id + ' / ' + theme, false, error && error.message ? error.message : String(error));
			}
		}
	}

	try {
		const clean = buildPage(fixtures[0], { theme: 'dark', sort: 'all', chrome: false }, fixtures);
		check(
			'chrome=0 omits the panel',
			!clean.includes('id="preview-panel"') && clean.includes(treeFor(fixtures[0]))
		);
	} catch (error) {
		check('chrome=0 omits the panel', false, error.message);
	}

	check('unknown theme is refused', (() => {
		try {
			readOptions(new URL('http://127.0.0.1/?theme=nope'));
			return false;
		} catch (error) {
			return error.status === 400;
		}
	})());

	check('unknown fixture is refused', resolveFixture(fixtures, '../package.json') === undefined);

	const server = createServer(fixtures);
	const port = await listen(server, 0);
	try {
		const health = await fetch('http://127.0.0.1:' + port + '/health');
		check('GET /health', health.status === 200 && (await health.text()) === 'ok');

		const page = await fetch(
			'http://127.0.0.1:' + port + '/preview?fixture=' + encodeURIComponent(fixtures[0].id) + '&theme=light'
		);
		const pageText = await page.text();
		check(
			'GET /preview',
			page.status === 200 &&
				pageText.includes(treeFor(fixtures[0])) &&
				pageText.includes('data-preview-theme="light"')
		);

		const bad = await fetch('http://127.0.0.1:' + port + '/preview?fixture=' + encodeURIComponent('../package.json'));
		check('server refuses an unknown fixture', bad.status === 400);
	} finally {
		server.close();
	}

	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	check('no runtime dependencies', !pkg.dependencies || Object.keys(pkg.dependencies).length === 0);

	console.log(failures === 0 ? '\npreview check: ok' : '\npreview check: ' + failures + ' failure(s)');
	process.exitCode = failures === 0 ? 0 : 1;
}

if (require.main === module) {
	const command = process.argv.includes('--check') ? runCheck : startPreview;
	command().catch((error) => {
		console.error('preview: ' + (error && error.message ? error.message : String(error)));
		process.exitCode = 1;
	});
}

module.exports = {
	THEMES,
	THEME_ORDER,
	buildPage,
	createServer,
	discoverFixtures,
	listen,
	loadProduction,
	resolveFixture,
};
