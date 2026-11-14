/**
 * The semantic diff panel.
 *
 * Both files are read through `workspace.openTextDocument`, so unsaved buffers are
 * compared. The page is read-only: nothing here uses `WorkspaceEdit`, writes a
 * file, or repairs anything. Every listener and timer is disposed with the panel.
 *
 * Refresh is a full re-scan after a short debounce, not an incremental update; the
 * page keeps its view mode, swap state, collapse set, selection, search and scroll.
 * If a side stops being ECUC while the panel is open, the last good document stays
 * visible with an error banner instead of silently showing stale ranges.
 */
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import {
	indentationAt,
	planCopy,
	planDelete,
	wrapWithAncestors,
	type MissingAncestor
} from '../core/copy/planCopy';
import { SORT_EXCEPTIONS } from '../core/ecuc/order';
import { scanEcucValues } from '../core/ecuc/scanner';
import { FileLabel, RangeLookup, compareTitle } from '../core/diff/diffModel';
import type { DiffCell } from '../core/diff/diffModel';
import { DiffSession } from '../core/diff/diffSession';
import type { DiffPreparedSide } from '../core/diff/diffSession';
import { diffShell } from './webviewShell';
import { fileName } from './compareSelection';
import { gateReason } from './ecucEditorProvider';
import { revealRangeInTextEditor } from './navigation';
import { watchBoot } from './bootWatchdog';
import { buildNodeIndex } from '../core/ecuc/nodeId';
import { buildRows } from '../core/ecuc/renderRows';
import { diffMessageType } from '../diffProtocol';
import type { DiffWebviewToProvider } from '../diffProtocol';

/** Re-scan debounce: one edit produces one refresh. */
const REFRESH_DEBOUNCE_MS = 150;

/** How long the page may take to report `ready` before the host warns. */
const BOOT_TIMEOUT_MS = 10_000;

function label(uri: vscode.Uri): FileLabel {
	return { name: fileName(uri), path: uri.fsPath };
}

function rowsFor(document: vscode.TextDocument) {
	const model = scanEcucValues(document.getText());
	const index = buildNodeIndex(model);
	const rows = buildRows(model, {
		sort: 'all',
		sortExcept: SORT_EXCEPTIONS,
	}).rows;
	// The row document deliberately carries no source positions; the diff gets each
	// cell's reveal range from the same node index that produced the ids.
	const rangeOf: RangeLookup = (id) => index.byId.get(id)?.range;
	const header = {
		schema: model.schema ? model.schema.release : undefined,
		packages: model.packages.map((pkg) => pkg.path.join('.')),
	};
	return { rows, rangeOf, header };
}

/** One prepared side; the version makes a toggle safely reuse it or refresh. */
interface PreparedSide extends DiffPreparedSide {
	document: vscode.TextDocument;
	version: number;
}

function prepareSide(document: vscode.TextDocument): PreparedSide {
	return { document, version: document.version, ...rowsFor(document) };
}

/** The first refusal reason for either side, or `undefined` when both are ECUC. */
function firstGateReason(
	left: vscode.TextDocument,
	leftUri: vscode.Uri,
	right: vscode.TextDocument,
	rightUri: vscode.Uri
): string | undefined {
	return gateReason(left.getText(), leftUri.fsPath) ?? gateReason(right.getText(), rightUri.fsPath);
}

function shellHtml(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): string {
	return diffShell({
		cspSource: panel.webview.cspSource || 'https://webview.test',
		scriptUri: webviewAsset(panel, context, 'diffViewer.js', 'https://webview.test/diffViewer.js'),
		styleUri: webviewAsset(panel, context, 'diffViewer.css', 'https://webview.test/diffViewer.css'),
		nonce: randomBytes(16).toString('base64'),
	});
}

function webviewAsset(
	panel: vscode.WebviewPanel,
	context: vscode.ExtensionContext,
	file: string,
	fallback: string
): string {
	return typeof panel.webview.asWebviewUri === 'function'
		? panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', file)).toString()
		: fallback;
}

/** True once the panel is disposed or a newer refresh superseded this one. */
function isStale(disposed: boolean, generation: number, currentGeneration: number): boolean {
	return disposed || generation !== currentGeneration;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class DiffPanel {
	public static readonly viewType = 'vscode-arxml-scope.diff';

	/**
	 * Reads and validates both sides, then opens the read-only diff panel.
	 * Returns false (with one warning and no panel) when either side is refused.
	 */
	public static async open(
		context: vscode.ExtensionContext,
		leftUri: vscode.Uri,
		rightUri: vscode.Uri
	): Promise<boolean> {
		const left = await DiffPanel.read(leftUri);
		if (!left) {
			return false;
		}
		const right = await DiffPanel.read(rightUri);
		if (!right) {
			return false;
		}
		const reason = firstGateReason(left, leftUri, right, rightUri);
		if (reason) {
			void vscode.window.showWarningMessage(reason);
			return false;
		}

		const leftLabel = label(leftUri);
		const rightLabel = label(rightUri);
		let preparedLeft = prepareSide(left);
		let preparedRight = prepareSide(right);
		let semantic = vscode.workspace
			.getConfiguration('arxmlScope.diff')
			.get<boolean>('semanticMatching', true);
		let session = new DiffSession(leftLabel, rightLabel, preparedLeft, preparedRight);
		let current = session.document(semantic).document;
		const panel = vscode.window.createWebviewPanel(
			DiffPanel.viewType,
			compareTitle(leftLabel, rightLabel),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [context.extensionUri],
			}
		);
		const disposables: vscode.Disposable[] = [];
		let disposed = false;
		let refreshTimer: ReturnType<typeof setTimeout> | undefined;
		let documentGeneration = 0;
		let mergeMode = false;

		panel.webview.html = shellHtml(panel, context);

		const boot = watchBoot(() => {
			void vscode.window.showWarningMessage(
				`"${fileName(leftUri)}" and "${fileName(rightUri)}" compared, but the diff page did not start. Run "Developer: Open Webview Developer Tools" to see the error.`
			);
		}, BOOT_TIMEOUT_MS);

		const postError = async (message: string): Promise<void> => {
			if (disposed) {
				return;
			}
			await panel.webview.postMessage({ type: 'error', message });
		};

		const clearRefreshTimer = (): void => {
			if (refreshTimer !== undefined) {
				clearTimeout(refreshTimer);
				refreshTimer = undefined;
			}
		};

		const refreshDocuments = async (generation: number): Promise<void> => {
			const nextLeft = await vscode.workspace.openTextDocument(leftUri);
			const nextRight = await vscode.workspace.openTextDocument(rightUri);
			if (isStale(disposed, generation, documentGeneration)) {
				return;
			}
			const why = firstGateReason(nextLeft, leftUri, nextRight, rightUri);
			if (why) {
				// Keep the last good document: the page still shows a useful
				// comparison and the banner explains why it stopped updating.
				await postError(why);
				return;
			}
			preparedLeft = prepareSide(nextLeft);
			preparedRight = prepareSide(nextRight);
			session = new DiffSession(leftLabel, rightLabel, preparedLeft, preparedRight);
			current = session.document(semantic).document;
			if (isStale(disposed, generation, documentGeneration)) {
				return;
			}
			await panel.webview.postMessage({ type: 'document', document: current, semantic });
		};

		const reportRefreshFailure = async (generation: number, error: unknown): Promise<void> => {
			if (isStale(disposed, generation, documentGeneration)) {
				return;
			}
			await postError(`The comparison could not be refreshed: ${errorMessage(error)}`);
		};

		const refreshNow = async (): Promise<void> => {
			const generation = ++documentGeneration;
			try {
				await refreshDocuments(generation);
			} catch (error) {
				await reportRefreshFailure(generation, error);
			}
		};

		const postMatchModeState = async (value: boolean): Promise<void> => {
			await panel.webview.postMessage({ type: 'matchModeState', semantic: value });
		};

		const preparedSidesStale = (
			liveLeft: vscode.TextDocument,
			liveRight: vscode.TextDocument
		): boolean => {
			return liveLeft.version !== preparedLeft.version || liveRight.version !== preparedRight.version;
		};

		const fullRefresh = async (): Promise<void> => {
			clearRefreshTimer();
			await refreshNow();
		};

		const switchMatchMode = async (next: boolean, generation: number): Promise<void> => {
			const liveLeft = await vscode.workspace.openTextDocument(leftUri);
			const liveRight = await vscode.workspace.openTextDocument(rightUri);
			if (isStale(disposed, generation, documentGeneration)) {
				return;
			}
			if (preparedSidesStale(liveLeft, liveRight)) {
				await fullRefresh();
				return;
			}
			const result = session.document(next);
			current = result.document;
			if (result.changed) {
				await panel.webview.postMessage({ type: 'document', document: current, semantic });
			} else {
				await postMatchModeState(semantic);
			}
		};

		const restoreMatchMode = async (
			previous: boolean,
			generation: number,
			error: unknown
		): Promise<void> => {
			if (isStale(disposed, generation, documentGeneration)) {
				return;
			}
			semantic = previous;
			await postMatchModeState(previous);
			await postError(`The comparison mode could not be switched: ${errorMessage(error)}`);
		};

		/**
		 * Switches the matching mode without re-scanning. The prepared sides are
		 * reused only while both documents still have the version they were built
		 * from; an edit that beats the debounce falls back to a full refresh.
		 */
		const applyMatchMode = async (next: boolean): Promise<void> => {
			if (disposed) {
				return;
			}
			if (semantic === next) {
				// A duplicate request still clears the page's pending state.
				await postMatchModeState(semantic);
				return;
			}
			const previous = semantic;
			semantic = next;
			const generation = ++documentGeneration;
			try {
				await switchMatchMode(next, generation);
			} catch (error) {
				await restoreMatchMode(previous, generation, error);
			}
		};

		const scheduleRefresh = (): void => {
			if (refreshTimer !== undefined) {
				clearTimeout(refreshTimer);
			}
			refreshTimer = setTimeout(() => {
				refreshTimer = undefined;
				void refreshNow();
			}, REFRESH_DEBOUNCE_MS);
		};

		const cellForReveal = (side: 'left' | 'right', key: string): DiffCell | undefined => {
			const row = current.rows.find((candidate) => candidate.key === key);
			if (row === undefined) {
				return undefined;
			}
			return side === 'left' ? row.left : row.right;
		};

		const revealCell = async (side: 'left' | 'right', range: DiffCell['range']): Promise<void> => {
			const uri = side === 'left' ? leftUri : rightUri;
			const document = await vscode.workspace.openTextDocument(uri);
			if (disposed) {
				return;
			}
			// `beside` is forced: the diff tab must survive even when the user's
			// revealMode is `replace`.
			await revealRangeInTextEditor(document, range, {
				viewColumn: panel.viewColumn,
				mode: 'beside',
			});
		};

		const reveal = async (side: 'left' | 'right', key: string): Promise<void> => {
			const cell = cellForReveal(side, key);
			if (!cell) {
				return;
			}
			try {
				await revealCell(side, cell.range);
			} catch (error) {
				await postError(`Could not open the ${side} source: ${errorMessage(error)}`);
			}
		};

		const onReady = (): void => {
			boot.settle();
			void panel.webview.postMessage({ type: 'document', document: current, semantic });
			void panel.webview.postMessage({ type: 'mergeMode', enabled: mergeMode });
		};

		/** One cell of a row by side. */
		const cellOn = (row: { left?: DiffCell; right?: DiffCell }, side: 'left' | 'right') => (side === 'left' ? row.left : row.right);

		const otherSideOf = (side: 'left' | 'right'): 'left' | 'right' => (side === 'left' ? 'right' : 'left');

		/** Where a directional sibling scan ends. */
		const scanStop = (step: 1 | -1): number => (step > 0 ? current.rows.length : -1);

		/** The nearest sibling with a cell on `side`, searching one direction. */
		const nearestSibling = (
			rowIndex: number,
			side: 'left' | 'right',
			step: 1 | -1
		): DiffCell | undefined => {
			const row = current.rows[rowIndex];
			for (let index = rowIndex + step; index !== scanStop(step); index += step) {
				const candidate = current.rows[index];
				if (candidate.parentKey !== row.parentKey) {
					continue;
				}
				const cell = cellOn(candidate, side);
				if (cell !== undefined) {
					return cell;
				}
			}
			return undefined;
		};

		const siblingAnchor = (
			rowIndex: number,
			side: 'left' | 'right'
		): { after?: { start: number; end: number }; before?: { start: number; end: number } } => ({
			after: nearestSibling(rowIndex, side, -1)?.range,
			before: nearestSibling(rowIndex, side, 1)?.range
		});

		const askReload = async (): Promise<void> => {
			const answer = await vscode.window.showWarningMessage(
				'The comparison changed. Reload it?',
				{ modal: true },
				'Reload'
			);
			if (answer === 'Reload') {
				await refreshNow();
			}
		};

		/** Applies one planned span as a single edit on `doc`. */
		const applyPlan = async (
			doc: vscode.TextDocument,
			plan: { start: number; end: number; text: string }
		): Promise<void> => {
			const edit = new vscode.WorkspaceEdit();
			edit.replace(doc.uri, new vscode.Range(doc.positionAt(plan.start), doc.positionAt(plan.end)), plan.text);
			if (!(await vscode.workspace.applyEdit(edit))) {
				await postError('VS Code refused the copy');
			}
		};

		/** The snapshot is older than the documents: reload before touching either. */
		const snapshotIsStale = (
			side: 'left' | 'right',
			clickedDoc: vscode.TextDocument,
			otherDoc: vscode.TextDocument
		): boolean => {
			const clickedPrepared = side === 'left' ? preparedLeft : preparedRight;
			const otherPrepared = side === 'left' ? preparedRight : preparedLeft;
			return clickedPrepared.version !== clickedDoc.version || otherPrepared.version !== otherDoc.version;
		};

		const locateCopy = (side: 'left' | 'right', key: string) => {
			const rowIndex = current.rows.findIndex((row) => row.key === key);
			if (rowIndex < 0) {
				return undefined;
			}
			const row = current.rows[rowIndex];
			const clickedCell = cellOn(row, side);
			const otherCell = cellOn(row, otherSideOf(side));
			if (clickedCell === undefined && otherCell === undefined) {
				return undefined;
			}
			return { rowIndex, clickedCell, otherCell };
		};

		/** The indentation a copied element needs: its target element, else its anchor. */
		const indentFor = (
			targetText: string,
			target: { start: number; end: number } | undefined,
			anchors: { after?: { start: number; end: number }; before?: { start: number; end: number } }
		): string => {
			if (target !== undefined) {
				return indentationAt(targetText, target.start);
			}
			if (anchors.after !== undefined) {
				return indentationAt(targetText, anchors.after.start);
			}
			return anchors.before === undefined ? '' : indentationAt(targetText, anchors.before.start);
		};

		const childKindOf = (kind: string): MissingAncestor['childKind'] => {
			if (kind === 'parameter') {
				return 'parameter';
			}
			return kind === 'reference' ? 'reference' : 'container';
		};

		/** The row indexes from a parent key up to the root, nearest first. */
		const parentChain = (key: string | null): number[] => {
			const chain: number[] = [];
			let cursor = key;
			while (cursor !== null) {
				const index = current.rows.findIndex((row) => row.key === cursor);
				if (index < 0) {
					return chain;
				}
				chain.push(index);
				cursor = current.rows[index].parentKey;
			}
			return chain;
		};

		const hasTargetCell = (row: { left?: DiffCell; right?: DiffCell }, side: 'left' | 'right'): boolean =>
			cellOn(row, otherSideOf(side)) !== undefined;

		const missingAncestor = (
			row: { left?: DiffCell; right?: DiffCell },
			side: 'left' | 'right',
			childKind: MissingAncestor['childKind']
		): MissingAncestor | undefined => {
			const cell = cellOn(row, side);
			return cell === undefined
				? undefined
				: {
						shortName: cell.shortName ?? cell.label,
						definitionRef: cell.definitionRef,
						definitionDest: cell.definitionDest,
						childKind
					};
		};

		/**
		 * The missing containers between a row and the nearest ancestor the target has.
		 * `undefined` when the chain reaches a module the target does not have.
		 */
		const ancestorChain = (
			parentKey: string | null,
			sourceSide: 'left' | 'right',
			childKind: MissingAncestor['childKind']
		): { ancestors: MissingAncestor[]; anchorParent: number } | undefined => {
			const ancestors: MissingAncestor[] = [];
			let kind = childKind;
			for (const index of parentChain(parentKey)) {
				const parent = current.rows[index];
				if (hasTargetCell(parent, sourceSide)) {
					return { ancestors, anchorParent: index };
				}
				const ancestor = missingAncestor(parent, sourceSide, kind);
				if (ancestor === undefined) {
					return undefined;
				}
				ancestors.push(ancestor);
				kind = 'container';
			}
			return undefined;
		};

		/** A module copy may not create a second module with the same short name. */
		const moduleCollision = (side: 'left' | 'right', rowIndex: number): boolean => {
			const row = current.rows[rowIndex];
			if (row.kind !== 'module') {
				return false;
			}
			const name = cellOn(row, side)?.shortName;
			if (name === undefined) {
				return false;
			}
			const targetSide = otherSideOf(side);
			return current.rows.some(
				(candidate) =>
					candidate !== row &&
					candidate.kind === 'module' &&
					cellOn(candidate, targetSide)?.shortName === name
			);
		};

		/** The insertion for a synthesized chain: after its preceding sibling, else before its anchor. */
		const chainInsertion = (
			before: DiffCell | undefined,
			after: DiffCell | undefined,
			indent: string,
			block: string
		): { start: number; end: number; text: string } => {
			if (before !== undefined) {
				return { start: before.range.end, end: before.range.end, text: `
${indent}${block}` };
			}
			const anchor = after as DiffCell;
			return { start: anchor.range.start, end: anchor.range.start, text: `${block}
${indent}` };
		};

		/** Creates the missing ancestors around the copied element and inserts the chain. */
		const synthesizeInto = async (
			clickedDoc: vscode.TextDocument,
			otherDoc: vscode.TextDocument,
			clickedCell: DiffCell,
			row: { parentKey: string | null; kind: string },
			side: 'left' | 'right'
		): Promise<boolean> => {
			const targetSide = otherSideOf(side);
			const chain = ancestorChain(row.parentKey, side, childKindOf(row.kind));
			if (chain === undefined) {
				await postError('the module is missing on the target side; copy it first');
				return true;
			}
			const before = nearestSibling(chain.anchorParent, targetSide, -1);
			const after = nearestSibling(chain.anchorParent, targetSide, 1);
			const anchor = before ?? after;
			if (anchor === undefined) {
				await postError('the target parent has no sibling to place this element next to');
				return true;
			}
			const targetText = otherDoc.getText();
			const sourceText = clickedDoc.getText();
			const indent = indentationAt(targetText, anchor.range.start);
			const block = wrapWithAncestors(
				sourceText.slice(clickedCell.range.start, clickedCell.range.end),
				indentationAt(sourceText, clickedCell.range.start),
				chain.ancestors,
				indent
			);
			await applyPlan(otherDoc, chainInsertion(before, after, indent, block));
			return true;
		};

		const deleteFromOther = async (doc: vscode.TextDocument, cell: DiffCell | undefined): Promise<void> => {
			if (cell !== undefined) {
				await copyDelete(doc, cell);
			}
		};

		const copyDelete = async (doc: vscode.TextDocument, cell: DiffCell): Promise<void> => {
			const plan = planDelete({
				targetText: doc.getText(),
				sourceText: '',
				target: cell.range,
				targetIndent: ''
			});
			if (!plan.ok) {
				await postError(plan.reason);
				return;
			}
			await applyPlan(doc, plan.span);
		};

		const copyInto = async (
			clickedDoc: vscode.TextDocument,
			otherDoc: vscode.TextDocument,
			clickedCell: DiffCell,
			otherCell: DiffCell | undefined,
			rowIndex: number,
			side: 'left' | 'right'
		): Promise<void> => {
			const targetText = otherDoc.getText();
			const target = otherCell?.range;
			const anchors: { after?: { start: number; end: number }; before?: { start: number; end: number } } =
				target === undefined ? siblingAnchor(rowIndex, side) : {};
			const plan = planCopy({
				targetText,
				sourceText: clickedDoc.getText(),
				source: clickedCell.range,
				target,
				anchorAfter: anchors.after,
				anchorBefore: anchors.before,
				targetIndent: indentFor(targetText, target, anchors)
			});
			if (!plan.ok) {
				await postError(plan.reason);
				return;
			}
			await applyPlan(otherDoc, plan.span);
		};

		/**
		 * One copy. `side` is where the click happened: that side's element moves to the
		 * other side. A click on the empty side deletes the element from the side that has
		 * it, which is how an added or removed row is resolved.
		 */
		const copyRow = async (side: 'left' | 'right', key: string): Promise<void> => {
			if (!mergeMode) {
				return;
			}
			const located = locateCopy(side, key);
			if (located === undefined) {
				return;
			}
			await runCopy(side, located);
		};

		const runCopy = async (
			side: 'left' | 'right',
			located: { rowIndex: number; clickedCell?: DiffCell; otherCell?: DiffCell }
		): Promise<void> => {
			const uriOf = (which: 'left' | 'right'): vscode.Uri => (which === 'left' ? leftUri : rightUri);
			const clickedDoc = await vscode.workspace.openTextDocument(uriOf(side));
			const otherDoc = await vscode.workspace.openTextDocument(uriOf(otherSideOf(side)));
			if (snapshotIsStale(side, clickedDoc, otherDoc)) {
				await askReload();
				return;
			}
			if (located.clickedCell === undefined) {
				await deleteFromOther(otherDoc, located.otherCell);
				return;
			}
			if (moduleCollision(side, located.rowIndex)) {
				await postError('that module already exists on the target side');
				return;
			}
			await copyInto(clickedDoc, otherDoc, located.clickedCell, located.otherCell, located.rowIndex, side);
		};

		const onMatchMode = (value: unknown): void => {
			if (typeof value === 'boolean') {
				void applyMatchMode(value);
			}
		};

		/** Merge mode and copy intents; false when the message is not one of them. */
		const handleMergeProtocol = (message: DiffWebviewToProvider): boolean => {
			if (message.type === 'mergeMode') {
				mergeMode = message.enabled === true;
				return true;
			}
			if (message.type === 'copy') {
				void copyRow(message.side, message.key);
				return true;
			}
			return false;
		};

		const handleSessionMessage = (message: DiffWebviewToProvider): boolean => {
			if (message.type === 'ready') {
				onReady();
				return true;
			}
			if (message.type === 'matchMode') {
				onMatchMode(message.semantic);
				return true;
			}
			return false;
		};

		const handleMessage = (message: DiffWebviewToProvider): void => {
			if (handleSessionMessage(message)) {
				return;
			}
			if (handleMergeProtocol(message)) {
				return;
			}
			if (message.type === 'reveal') {
				void reveal(message.side, message.key);
			}
		};

		disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				const changed = event.document.uri.toString();
				if (changed === leftUri.toString() || changed === rightUri.toString()) {
					scheduleRefresh();
				}
			})
		);

		disposables.push(
			panel.webview.onDidReceiveMessage((raw: unknown) => {
				if (!diffMessageType(raw)) {
					return;
				}
				handleMessage(raw as DiffWebviewToProvider);
			})
		);

		panel.onDidDispose(() => {
			disposed = true;
			boot.dispose();
			clearRefreshTimer();
			for (const disposable of disposables) {
				disposable.dispose();
			}
		});

		return true;
	}

	/** Opens a side as a text document; an unreadable file is warned about, not thrown. */
	private static async read(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
		try {
			return await vscode.workspace.openTextDocument(uri);
		} catch (error) {
			void vscode.window.showWarningMessage(
				`Cannot read "${fileName(uri)}" for comparison: ${error instanceof Error ? error.message : String(error)}`
			);
			return undefined;
		}
	}
}
