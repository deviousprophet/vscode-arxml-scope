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
import { FileLabel, RangeLookup, compareTitle } from '../core/diff/diffModel';
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

/** Re-scan debounce: one edit produces one refresh (design §4.1). */
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

		panel.webview.html = diffShell({
			cspSource: panel.webview.cspSource || 'https://webview.test',
			scriptUri:
				typeof panel.webview.asWebviewUri === 'function'
					? panel.webview
							.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'diffViewer.js'))
							.toString()
					: 'https://webview.test/diffViewer.js',
			styleUri:
				typeof panel.webview.asWebviewUri === 'function'
					? panel.webview
							.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'diffViewer.css'))
							.toString()
					: 'https://webview.test/diffViewer.css',
			nonce: randomBytes(16).toString('base64'),
		});

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
			const generation = ++documentGeneration;
			try {
				const nextLeft = await vscode.workspace.openTextDocument(leftUri);
				const nextRight = await vscode.workspace.openTextDocument(rightUri);
				if (disposed || generation !== documentGeneration) {
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
				preparedLeft = prepareSide(nextLeft);
				preparedRight = prepareSide(nextRight);
				session = new DiffSession(leftLabel, rightLabel, preparedLeft, preparedRight);
				current = session.document(semantic).document;
				if (disposed || generation !== documentGeneration) {
					return;
				}
				await panel.webview.postMessage({ type: 'document', document: current, semantic });
			} catch (error) {
				if (disposed || generation !== documentGeneration) {
					return;
				}
				await postError(
					`The comparison could not be refreshed: ${error instanceof Error ? error.message : String(error)}`
				);
			}
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
				await panel.webview.postMessage({ type: 'matchModeState', semantic });
				return;
			}
			const previous = semantic;
			semantic = next;
			const generation = ++documentGeneration;
			try {
				const liveLeft = await vscode.workspace.openTextDocument(leftUri);
				const liveRight = await vscode.workspace.openTextDocument(rightUri);
				if (disposed || generation !== documentGeneration) {
					return;
				}
				if (liveLeft.version !== preparedLeft.version || liveRight.version !== preparedRight.version) {
					if (refreshTimer !== undefined) {
						clearTimeout(refreshTimer);
						refreshTimer = undefined;
					}
					await refreshNow();
					return;
				}
				const result = session.document(next);
				current = result.document;
				if (result.changed) {
					await panel.webview.postMessage({ type: 'document', document: current, semantic });
				} else {
					await panel.webview.postMessage({ type: 'matchModeState', semantic });
				}
			} catch (error) {
				if (disposed || generation !== documentGeneration) {
					return;
				}
				semantic = previous;
				await panel.webview.postMessage({ type: 'matchModeState', semantic: previous });
				await postError(
					`The comparison mode could not be switched: ${error instanceof Error ? error.message : String(error)}`
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
			panel.webview.onDidReceiveMessage((raw: unknown) => {
				if (!diffMessageType(raw)) {
					return;
				}
				const message = raw as DiffWebviewToProvider;
				if (message.type === 'ready') {
					boot.settle();
					void panel.webview.postMessage({ type: 'document', document: current, semantic });
					return;
				}
				if (message.type === 'matchMode') {
					if (typeof message.semantic === 'boolean') {
						void applyMatchMode(message.semantic);
					}
					return;
				}
				if (message.type === 'reveal') {
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
