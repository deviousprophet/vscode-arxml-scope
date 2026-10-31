/**
 * The semantic diff panel (task design §4).
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
import { SORT_EXCEPTIONS } from '../core/ecuc/order';
import { scanEcucValues } from '../core/ecuc/scanner';
import { DiffDocument, FileLabel, RangeLookup, buildDiffDocument, compareTitle } from './diffModel';
import { renderDiffHtml } from './diffPage';
import { fileName } from './compareSelection';
import { gateReason } from '../editor/ecucEditorProvider';
import { revealRangeInTextEditor } from '../editor/navigation';
import { watchBoot } from '../editor/bootWatchdog';
import { buildNodeIndex } from '../editor/nodeId';
import { buildRows } from '../editor/renderRows';

/** Re-scan debounce: one edit produces one refresh (design §4.1). */
const REFRESH_DEBOUNCE_MS = 150;

/** How long the page may take to report `ready` before the host warns. */
const BOOT_TIMEOUT_MS = 10_000;

interface WebviewMessage {
	type?: string;
	side?: 'left' | 'right';
	key?: string;
}

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
		const reason =
			gateReason(left.getText(), leftUri.fsPath) ?? gateReason(right.getText(), rightUri.fsPath);
		if (reason) {
			void vscode.window.showWarningMessage(reason);
			return false;
		}

		const leftLabel = label(leftUri);
		const rightLabel = label(rightUri);
		const leftRows = rowsFor(left);
		const rightRows = rowsFor(right);
		let current = buildDiffDocument(
			leftLabel,
			rightLabel,
			leftRows.rows,
			rightRows.rows,
			leftRows.rangeOf,
			rightRows.rangeOf,
			{ left: leftRows.header, right: rightRows.header }
		);
		const html = renderDiffHtml(current, { nonce: randomBytes(16).toString('base64') });

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
		let refreshGeneration = 0;

		panel.webview.html = html;

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

		const refreshNow = async (): Promise<void> => {
			const generation = ++refreshGeneration;
			try {
				const nextLeft = await vscode.workspace.openTextDocument(leftUri);
				const nextRight = await vscode.workspace.openTextDocument(rightUri);
				if (disposed || generation !== refreshGeneration) {
					return;
				}
				const why =
					gateReason(nextLeft.getText(), leftUri.fsPath) ??
					gateReason(nextRight.getText(), rightUri.fsPath);
				if (why) {
					// Keep the last good document: the page still shows a useful
					// comparison and the banner explains why it stopped updating.
					await postError(why);
					return;
				}
				const nextLeftRows = rowsFor(nextLeft);
				const nextRightRows = rowsFor(nextRight);
				const next: DiffDocument = buildDiffDocument(
					leftLabel,
					rightLabel,
					nextLeftRows.rows,
					nextRightRows.rows,
					nextLeftRows.rangeOf,
					nextRightRows.rangeOf,
					{ left: nextLeftRows.header, right: nextRightRows.header }
				);
				if (disposed || generation !== refreshGeneration) {
					return;
				}
				current = next;
				await panel.webview.postMessage({ type: 'diff', document: next });
			} catch (error) {
				if (disposed || generation !== refreshGeneration) {
					return;
				}
				await postError(
					`The comparison could not be refreshed: ${error instanceof Error ? error.message : String(error)}`
				);
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

		const reveal = async (side: 'left' | 'right', key: string): Promise<void> => {
			const row = current.rows.find((candidate) => candidate.key === key);
			const cell = row ? (side === 'left' ? row.left : row.right) : undefined;
			if (!cell) {
				return;
			}
			try {
				const uri = side === 'left' ? leftUri : rightUri;
				const document = await vscode.workspace.openTextDocument(uri);
				if (disposed) {
					return;
				}
				// `beside` is forced: the diff tab must survive even when the user's
				// revealMode is `replace` (R15/AC9).
				await revealRangeInTextEditor(document, cell.range, {
					viewColumn: panel.viewColumn,
					mode: 'beside',
				});
			} catch (error) {
				await postError(
					`Could not open the ${side} source: ${error instanceof Error ? error.message : String(error)}`
				);
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
			panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
				if (!message) {
					return;
				}
				if (message.type === 'ready') {
					boot.settle();
					return;
				}
				if (
					message.type === 'reveal' &&
					(message.side === 'left' || message.side === 'right') &&
					typeof message.key === 'string'
				) {
					void reveal(message.side, message.key);
				}
			})
		);

		panel.onDidDispose(() => {
			disposed = true;
			boot.dispose();
			if (refreshTimer !== undefined) {
				clearTimeout(refreshTimer);
				refreshTimer = undefined;
			}
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
