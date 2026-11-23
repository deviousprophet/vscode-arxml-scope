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
	/** Opens the native find widget and seeds this query, with Rust-shaped results. */
	find?: string;
	/** Types this text into the first parameter to exercise the local dirty state. */
	edit?: string;
	/** Types this text into the Details value control of a textual parameter. */
	detailsEdit?: string;
	/** Presses Ctrl+S after the Details typing and answers the edit acknowledgements. */
	detailsSave?: boolean;
	/** Runs one local undo after the Details typing. */
	detailsUndo?: boolean;
	/** Runs one local redo after that undo. */
	detailsRedo?: boolean;
	/** Runs the direct-editor delete/word-delete/replace typing scenario. */
	deleteEdit?: boolean;
	/** Renames the selected container, then types again before the re-scan echo. */
	detailsRename?: boolean;
	/** With `detailsRename`, refuses the post-flush rename edit after the re-scan. */
	renameRefusal?: boolean;
	/** With `detailsRename`, delivers the re-scan before the rename acknowledgement. */
	renameLateAck?: boolean;
	/** Edits the textual and decimal values, then Ctrl+S with both acknowledgements. */
	multiSave?: boolean;
	/** Pastes text containing a newline into the textual value span. */
	pasteEdit?: boolean;
	/** Types a draft, removes its row from the re-scan, then attempts Ctrl+S. */
	staleSave?: boolean;
	/** Scrolls the editor to this 1-based line and waits for sticky scope. */
	scrollLine?: number;
	/** Attempts Ctrl+S after the edit, exercising the save guard. */
	trySave?: boolean;
}

export const STATES: PreviewState[] = [
	{ name: 'diff-off', page: 'diff', width: 1400, height: 900 },
	{ name: 'diff-merge', page: 'diff', width: 1400, height: 900, merge: true },
	{ name: 'diff-swap', page: 'diff', width: 1400, height: 900, merge: true, swap: true },
	{ name: 'diff-rail', page: 'diff', width: 1400, height: 900, jump: 1 },
	{ name: 'diff-one-sided', page: 'diff', width: 1400, height: 900, merge: true },
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
	{ name: 'editor-syntax', page: 'editor', width: 1400, height: 900 },
	{ name: 'editor-syscond', page: 'editor', width: 1400, height: 900 },
	{ name: 'editor-labels', page: 'editor', width: 1400, height: 900 },
	{ name: 'editor-dirty', page: 'editor', width: 1400, height: 900, edit: '42' },
	{ name: 'editor-invalid', page: 'editor', width: 1400, height: 900, edit: 'abc', trySave: true },
	{ name: 'editor-details', page: 'editor', width: 1400, height: 900, detailsEdit: ' updated' },
	{ name: 'editor-details-save', page: 'editor', width: 1400, height: 900, detailsEdit: ' updated', detailsSave: true },
	{ name: 'editor-details-undo', page: 'editor', width: 1400, height: 900, detailsEdit: ' updated', detailsUndo: true },
	{ name: 'editor-details-redo', page: 'editor', width: 1400, height: 900, detailsEdit: ' updated', detailsUndo: true, detailsRedo: true },
	{ name: 'editor-delete', page: 'editor', width: 1400, height: 900, deleteEdit: true },
	{ name: 'editor-details-rename', page: 'editor', width: 1400, height: 900, detailsRename: true },
	{ name: 'editor-rename-refusal', page: 'editor', width: 1400, height: 900, detailsRename: true, renameRefusal: true },
	{ name: 'editor-rename-late-ack', page: 'editor', width: 1400, height: 900, detailsRename: true, renameLateAck: true },
	{ name: 'editor-multi-save', page: 'editor', width: 1400, height: 900, multiSave: true },
	{ name: 'editor-paste', page: 'editor', width: 1400, height: 900, pasteEdit: true },
	{ name: 'editor-stale-save', page: 'editor', width: 1400, height: 900, staleSave: true },
	{ name: 'editor-sticky', page: 'editor', width: 1400, height: 900, scrollLine: 40 },
	{ name: 'editor-find', page: 'editor', width: 1400, height: 900, find: 'Items' },
	{ name: 'diff-find', page: 'diff', width: 1400, height: 900, merge: true, find: 'Items' },
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

/** A module/container/parameter block for the one-sided preview fixture. */
function oneSidedModule(shortName: string, containers: string): string {
	return `<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>${shortName}</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/${shortName}</DEFINITION-REF><CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>`;
}

function oneSidedContainer(module: string, shortName: string, parameters: string): string {
	return `<ECUC-CONTAINER-VALUE><SHORT-NAME>${shortName}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/${module}/${shortName}</DEFINITION-REF><PARAMETER-VALUES>${parameters}</PARAMETER-VALUES></ECUC-CONTAINER-VALUE>`;
}

function oneSidedValue(module: string, container: string, name: string, value: string): string {
	return `<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/${module}/${container}/${name}</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
}

/** One module tree exists on only one side; a shared module/container/value aligns. */
function oneSidedDocument(side: 'left' | 'right'): string {
	const module = side === 'left' ? 'RemovedMod' : 'AddedMod';
	const container = side === 'left' ? 'RemovedItems' : 'AddedItems';
	const value = side === 'left' ? 'RemovedValue' : 'AddedValue';
	const modules = [
		oneSidedModule(
			module,
			oneSidedContainer(module, container, oneSidedValue(module, container, value, side === 'left' ? '1' : '2'))
		),
		oneSidedModule(
			'Shared',
			oneSidedContainer(
				'Shared',
				'SharedItems',
				oneSidedValue('Shared', 'SharedItems', 'SharedValue', '5') +
					oneSidedValue('Shared', 'SharedItems', 'ChangedValue', side === 'left' ? '6' : '7')
			)
		)
	];
	return `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>${modules.join('')}</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

/** A left-only and a right-only module/container, plus a shared subtree with one change. */
function oneSidedPair(): DiffDocument {
	const leftSide = rowsOf(oneSidedDocument('left'));
	const rightSide = rowsOf(oneSidedDocument('right'));
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

function editorDocument(): { rows: EcucRow[]; selectedId?: string } {
	const rows = rowsOf(synthetic(values(1100, () => false))).rows;
	return { rows, selectedId: rows[0]?.id };
}

/** The small ECUC document used by the editor states; renaming its container re-keys every descendant. */
const SYNTAX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>Syn</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/Syn</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Syntax</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/Syn/Syntax</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Syn/Syntax/Decimal</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Syn/Syntax/Binary</DEFINITION-REF><VALUE>0b1010</VALUE></ECUC-NUMERICAL-PARAM-VALUE><ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/P/Syn/Syntax/Text</DEFINITION-REF><VALUE>hello</VALUE></ECUC-TEXTUAL-PARAM-VALUE><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Syn/Syntax/Condition</DEFINITION-REF><VALUE>1</VALUE><SW-SYSCOND BINDING-TIME="CODE-GENERATION-TIME">(<SYSC-REF DEST="SW-SYSTEMCONST">/P/SwSystemconsts/CANIPCORETYPE_SC</SYSC-REF>==0)</SW-SYSCOND></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES><REFERENCE-VALUES><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/Syn/Syntax/Next</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">P.Syn.Syntax.Target</VALUE-REF></ECUC-REFERENCE-VALUE></REFERENCE-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;

/** A small editor document that exercises numeric, binary, text and reference colors. */
function syntaxDocument(selectedLabel = 'Binary'): { rows: EcucRow[]; selectedId?: string } {
	const rows = rowsOf(SYNTAX_XML).rows;
	const selected = rows.find((row) => row.label === selectedLabel) ?? rows[0];
	return { rows, selectedId: selected?.id };
}

/** The syntax document with a boolean literal in the condition expression. */
const SYSCOND_XML = SYNTAX_XML.replace('==0)</SW-SYSCOND>', '==0)||(FEATURE==true)</SW-SYSCOND>');

/** The condition-bearing row selected, so Details shows the whole palette. */
function syscondDocument(): { rows: EcucRow[]; selectedId?: string } {
	const rows = rowsOf(SYSCOND_XML).rows;
	const selected = rows.find((row) => row.label === 'Condition') ?? rows[0];
	return { rows, selectedId: selected?.id };
}

/** A module with a normal container, a parameter and a container with no DEFINITION-REF. */
const LABELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>Labels</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/Labels</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Items</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/Labels/Items</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Labels/Items/P0000</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE><ECUC-CONTAINER-VALUE><SHORT-NAME>EmptyDef</SHORT-NAME></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;

/** The no-label container selected: its line starts with the quoted short name. */
function labelsDocument(): { rows: EcucRow[]; selectedId?: string } {
	const rows = rowsOf(LABELS_XML).rows;
	const selected = rows.find((row) => row.shortName === 'EmptyDef') ?? rows[0];
	return { rows, selectedId: selected?.id };
}

/** The same document after the container rename the page echoed: real new ids. */
function renamedSyntaxDocument(): { rows: EcucRow[]; selectedId?: string } {
	const renamed = SYNTAX_XML.replace('<SHORT-NAME>Syntax</SHORT-NAME>', '<SHORT-NAME>Syntax2</SHORT-NAME>');
	const rows = rowsOf(renamed).rows;
	// A rename does not change the DEFINITION-REF, so the row label stays "Syntax";
	// the short name and the path-based id are what moved.
	const selected = rows.find((row) => row.shortName === 'Syntax2') ?? rows[0];
	return { rows, selectedId: selected?.id };
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
/* Deliberately no line backgrounds: older VS Code themes omit them, so the
 * preview exercises the readable dark fallbacks. Text fills use rgba() so the
 * alpha-preserving conversion is exercised too. */
--vscode-diffEditor-insertedTextBackground:rgba(87, 171, 90, 0.30);
--vscode-diffEditor-removedTextBackground:rgba(244, 112, 103, 0.30);
--vscode-diffEditor-modifiedTextBackground:#3a3320;
--vscode-diffEditorGutter-insertedLineBackground:#244b2e;
--vscode-diffEditorGutter-removedLineBackground:#5a2b2b;
--vscode-gitDecoration-addedResourceForeground:#81b88b;
--vscode-gitDecoration-deletedResourceForeground:#f85149;
--vscode-gitDecoration-modifiedResourceForeground:#e2c08d;
--vscode-editorInfo-foreground:#3794ff;
--vscode-editorWarning-foreground:#cca700;
--vscode-editorError-foreground:#f85149;
/* The Dark+ number/string scopes the Details condition code reuses; the
 * condition palette itself is fixed per theme class in tokens.css. */
--vscode-debugTokenExpression-number:#B5CEA8;
--vscode-debugTokenExpression-string:#CE9178;
}</style>`;

const ASSETS = { cspSource: '', scriptUri: '/preview.js', styleUri: '/preview.css', workerUri: '/monaco.worker.js', nonce: 'preview' };

/** The fixture document a state mounts. */
function documentFor(state: PreviewState) {
	if (state.page !== 'diff') {
		if (state.name === 'editor-syntax') {
			return syntaxDocument();
		}
		if (state.name === 'editor-syscond') {
			// The host selects the condition-bearing row; Details shows its Condition code.
			return syscondDocument();
		}
		if (state.name === 'editor-labels') {
			// The no-label container is selected; its line starts with the short name.
			return labelsDocument();
		}
		if (state.name === 'editor-details-rename') {
			return syntaxDocument('Syntax');
		}
		if (state.name === 'editor-rename-refusal') {
			return syntaxDocument('Syntax');
		}
		if (state.name === 'editor-rename-late-ack') {
			return syntaxDocument('Syntax');
		}
		return state.name === 'editor-details' ||
			state.name === 'editor-details-save' ||
			state.name === 'editor-details-undo' ||
			state.name === 'editor-details-redo' ||
			state.name === 'editor-delete' ||
			state.name === 'editor-multi-save' ||
			state.name === 'editor-paste' ||
			state.name === 'editor-stale-save'
			? syntaxDocument('Text')
			: editorDocument();
	}
	if (state.name === 'diff-one-sided') {
		return oneSidedPair();
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
		select: state.select,
		find: state.find,
		edit: state.edit,
		detailsEdit: state.detailsEdit,
		detailsSave: state.detailsSave,
		detailsUndo: state.detailsUndo,
		detailsRedo: state.detailsRedo,
		deleteEdit: state.deleteEdit,
		detailsRename: state.detailsRename,
		renameRefusal: state.renameRefusal,
		renameLateAck: state.renameLateAck,
		renameDocument: state.detailsRename === true ? renamedSyntaxDocument() : undefined,
		multiSave: state.multiSave,
		pasteEdit: state.pasteEdit,
		staleSave: state.staleSave,
		scrollLine: state.scrollLine,
		trySave: state.trySave
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
