/**
 * Server-side state for the webview preview.
 *
 * Runs in Node (bundled by `scripts/previewWebview.mjs`): it builds the synthetic
 * documents with the real scanner, row builder and diff builder, renders the
 * production shell, and inlines the protocol payload. No page code is forked.
 */
import { diffShell, editorShell } from '../../host/webviewShell';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildRows } from '../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildDiffDocument } from '../../core/diff/diffModel';
import type { DiffDocument } from '../../core/diff/diffModel';
import type { EcucRow } from '../../core/ecuc/renderRows';

export interface PreviewState {
	name: string;
	page: 'diff' | 'editor';
	width: number;
	height: number;
	merge?: boolean;
	swap?: boolean;
	/** Long parameter names force horizontal overflow; the copy arrows must survive it. */
	wide?: boolean;
	/** Horizontal scroll offset applied after the page renders. */
	pan?: number;
	/** F7 presses after mounting; the long document's first change is near line 1000. */
	jump?: number;
	select?: boolean;
}

export const STATES: PreviewState[] = [
	{ name: 'diff-off', page: 'diff', width: 1400, height: 900 },
	{ name: 'diff-merge', page: 'diff', width: 1400, height: 900, merge: true },
	{ name: 'diff-swap', page: 'diff', width: 1400, height: 900, merge: true, swap: true },
	{ name: 'diff-rail', page: 'diff', width: 1400, height: 900, jump: 1 },
	{ name: 'diff-wide', page: 'diff', width: 1400, height: 900, merge: true, wide: true },
	{
		name: 'diff-wide-panned',
		page: 'diff',
		width: 1400,
		height: 900,
		merge: true,
		wide: true,
		pan: 600
	},
	{ name: 'editor', page: 'editor', width: 1400, height: 900, select: true },
	{ name: 'toolbar-1400', page: 'diff', width: 1400, height: 900, merge: true },
	{ name: 'toolbar-1200', page: 'diff', width: 1200, height: 900, merge: true },
	{ name: 'toolbar-1024', page: 'diff', width: 1024, height: 900, merge: true },
	{ name: 'toolbar-900', page: 'diff', width: 900, height: 900, merge: true },
	{ name: 'toolbar-800', page: 'diff', width: 800, height: 900, merge: true },
	{ name: 'toolbar-640', page: 'diff', width: 640, height: 900, merge: true }
];

const MODULE = 'Preview';
const CONTAINER = 'Items';
const MERGE_CHANGES = new Set([2, 5, 9, 20]);
/** Pushes a row well past a 1400px pane when `wide` is set. */
const WIDE_SUFFIX = '_' + 'X'.repeat(180);
const PAIR_HEADERS = {
	left: { packages: ['P.Preview'] },
	right: { schema: '00048', packages: ['P.Preview'] }
};

/** Values 0..count-1; a changed index is shifted to make the row differ. */
function values(count: number, changed: (at: number) => boolean, shift = 0): string[] {
	return Array.from({ length: count }, (_, at) => String(changed(at) ? at + shift : at));
}

/** A module with one container and one parameter per value. */
function synthetic(list: readonly string[], wide = false): string {
	const parameters = list
		.map((value, at) => {
			const name = `P${String(at).padStart(4, '0')}${wide ? WIDE_SUFFIX : ''}`;
			return `<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/${MODULE}/${CONTAINER}/${name}</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
		})
		.join('');
	return `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>${MODULE}</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/${MODULE}</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>${CONTAINER}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/${MODULE}/${CONTAINER}</DEFINITION-REF><PARAMETER-VALUES>${parameters}</PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

function rowsOf(text: string): { rows: EcucRow[]; rangeOf: (id: string) => { start: number; end: number } | undefined } {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	const rows = buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
	return { rows, rangeOf: (id) => index.byId.get(id)?.range };
}

/** Build one diff pair from the two value lists. */
function diffPair(leftValues: readonly string[], rightValues: readonly string[], wide = false): DiffDocument {
	const leftSide = rowsOf(synthetic(leftValues, wide));
	const rightSide = rowsOf(synthetic(rightValues, wide));
	return buildDiffDocument(
		{ name: 'left.arxml', path: '/preview/left.arxml' },
		{ name: 'right.arxml', path: '/preview/right.arxml' },
		leftSide.rows,
		rightSide.rows,
		leftSide.rangeOf,
		rightSide.rangeOf,
		PAIR_HEADERS,
		{ semanticMatching: true }
	);
}

/** A short pair with a few changed rows: enough for arrows and tints. */
function mergePair(): DiffDocument {
	return diffPair(values(60, () => false), values(60, (at) => MERGE_CHANGES.has(at), 100));
}

/** The merge pair with long names, so each row is wider than a pane. */
function widePair(): DiffDocument {
	return diffPair(values(60, () => false), values(60, (at) => MERGE_CHANGES.has(at), 100), true);
}

/** 1,100 parameters; only the last few change, so F7 lands on a four-digit line. */
function railPair(): DiffDocument {
	return diffPair(values(1100, () => false), values(1100, (at) => at >= 1000, 500));
}

function editorDocument(): { rows: EcucRow[]; selectedId?: string } {
	const rows = rowsOf(synthetic(values(1100, () => false))).rows;
	return { rows, selectedId: rows[0]?.id };
}

/** The supported dark-theme variables the extension gets from VS Code; without
 * them the gutter is transparent and the rail can be mistaken for a stray edge. */
const THEME = `<style>:root{
--vscode-foreground:#cccccc;
--vscode-editor-foreground:#cccccc;
--vscode-editor-background:#1e1e1e;
--vscode-editorGutter-background:#1e1e1e;
--vscode-editorLineNumber-foreground:#858585;
--vscode-editorLineNumber-activeForeground:#c6c6c6;
--vscode-editorGroup-border:#3c3c3c;
--vscode-panel-border:#3c3c3c;
--vscode-focusBorder:#007fd4;
--vscode-toolbar-hoverBackground:#2a2d2e;
--vscode-list-hoverBackground:#2a2d2e;
--vscode-input-background:#3c3c3c;
--vscode-input-foreground:#cccccc;
--vscode-input-border:#3c3c3c;
--vscode-inputOption-activeBackground:#094771;
--vscode-inputOption-activeForeground:#ffffff;
--vscode-button-background:#0e639c;
--vscode-button-foreground:#ffffff;
--vscode-button-secondaryBackground:#3a3d41;
--vscode-button-secondaryForeground:#ffffff;
--vscode-diffEditor-insertedLineBackground:#1b3a24;
--vscode-diffEditor-removedLineBackground:#4a1f1f;
--vscode-diffEditor-modifiedTextBackground:#3a3320;
--vscode-diffEditorGutter-insertedLineBackground:#244b2e;
--vscode-diffEditorGutter-removedLineBackground:#5a2b2b;
--vscode-gitDecoration-addedResourceForeground:#81b88b;
--vscode-gitDecoration-deletedResourceForeground:#f85149;
--vscode-gitDecoration-modifiedResourceForeground:#e2c08d;
--vscode-editorInfo-foreground:#3794ff;
--vscode-editorWarning-foreground:#cca700;
--vscode-editorError-foreground:#f85149;
}</style>`;

const ASSETS = { cspSource: '', scriptUri: '/preview.js', styleUri: '/preview.css', nonce: 'preview' };

/** The fixture document a state mounts. */
function documentFor(state: PreviewState) {
	if (state.page !== 'diff') {
		return editorDocument();
	}
	return state.wide ? widePair() : state.name === 'diff-rail' ? railPair() : mergePair();
}

function messageFor(state: PreviewState, document: unknown) {
	return state.page === 'diff'
		? { type: 'document', semantic: true, document }
		: { type: 'document', document };
}

function payloadFor(state: PreviewState, document: unknown) {
	return {
		state: state.name,
		page: state.page,
		message: messageFor(state, document),
		merge: state.merge,
		swap: state.swap,
		wide: state.wide,
		pan: state.pan,
		jump: state.jump,
		select: state.select
	};
}

function inject(shell: string, payload: unknown): string {
	const json = JSON.stringify(payload).replaceAll('<', '\\u003c');
	const bootstrap = `<script>window.__PREVIEW__=${json};window.__PREVIEW_MESSAGES__=[];window.acquireVsCodeApi=function(){return{postMessage:function(message){window.__PREVIEW_MESSAGES__.push(message);},getState:function(){return undefined;},setState:function(){}};};</script>`;
	return shell
		.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
		.replace('</head>', `${THEME}</head>`)
		.replace('<script nonce=', `${bootstrap}<script nonce=`);
}

/** The full shell for one state: production markup, payload and asset URLs. */
export function previewHtml(state: PreviewState): string {
	const shell = state.page === 'diff' ? diffShell(ASSETS) : editorShell(ASSETS);
	return inject(shell, payloadFor(state, documentFor(state)));
}
