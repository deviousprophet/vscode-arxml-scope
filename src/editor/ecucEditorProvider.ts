/**
 * The ECUC custom text editor (child design §1, §2).
 *
 * `resolveCustomTextEditor` runs once per panel. Order matters: the gate completes
 * before any HTML is set, so a refused file never flashes an empty tree.
 *
 * `CustomTextEditorProvider` has no `openCustomDocument`, no
 * `onDidChangeCustomDocument` and no save/revert hooks — undo, redo, dirty state and
 * save belong to the real `TextDocument`. The one write this provider performs goes
 * through `WorkspaceEdit` onto that document, so it participates in that history
 * (child design §2.4, §2.7).
 */
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { isArxmlPath, isEcucValues } from '../core/ecuc/detect';
import { ReferenceNode, SortMode } from '../core/ecuc/model';
import { SORT_EXCEPTIONS } from '../core/ecuc/order';
import { scanEcucValues } from '../core/ecuc/scanner';
import { ConditionValue } from '../core/ecuc/syscond';
import { ConditionEntry, ConditionValueStore, parseConditionEntries } from './conditionValues';
import { RenderOptions, renderHtml } from './renderHtml';
import { buildRows } from './renderRows';
import { buildNodeIndex } from './nodeId';
import { applyEdit, buildEdit, buildFieldEdit } from './ecucEdit';
import {
	applyStructureEdit,
	duplicateNameRefusal,
	planDelete,
	planDuplicate,
} from './ecucStructureEdit';
import { followReference, nodeIdForRange, revealRangeInTextEditor } from './navigation';
import { watchBoot } from './bootWatchdog';

export const VIEW_TYPE = 'vscode-arxml-scope.ecucEditor';

/** How long a panel may take to report `ready` before the host warns (R3). */
const BOOT_TIMEOUT_MS = 10_000;

/** The field a `type: 'edit'` message targets; absent means the parameter `<VALUE>`. */
type EditField = 'value' | 'shortName' | 'definitionRef';

const EDIT_FIELDS: readonly EditField[] = ['value', 'shortName', 'definitionRef'];

interface WebviewMessage {
	type?: string;
	nodeId?: string;
	/** The field the edit targets; old webview code omits it, which means `value`. */
	field?: EditField;
	/** The text the user typed, for `type: 'edit'` (parent design §8). */
	value?: string;
	/** Raw condition entries for `type: 'conditions'`; validated before use. */
	entries?: unknown;
}

/**
 * Why a document cannot be rendered, or `undefined` when it can (AC2, parent R2).
 * Shared by the provider and the open command so both refuse for the same reason.
 */
export function gateReason(text: string, filePath: string): string | undefined {
	const name = path.basename(filePath);
	if (!isArxmlPath(filePath)) {
		return `"${name}" is not an .arxml file; showing the text editor instead.`;
	}
	if (!isEcucValues(text, filePath)) {
		return `"${name}" contains no ECUC values; showing the text editor instead.`;
	}
	return undefined;
}

function editorSettings(): { sort: SortMode; sortExcept: readonly string[] } {
	const config = vscode.workspace.getConfiguration('arxmlScope.ecuc.editor');
	const sort = config.get<SortMode>('sort', 'all');
	return {
		sort: sort === 'declaration' ? 'declaration' : 'all',
		sortExcept: config.get<string[]>('sortExcept', [...SORT_EXCEPTIONS]),
	};
}

export class EcucEditorProvider implements vscode.CustomTextEditorProvider {
	/** Open panels by document, so `selectNode` can reach a panel that already exists. */
	private readonly panels = new Map<string, vscode.WebviewPanel>();
	/** Selections requested before their panel existed, consumed by `resolveCustomTextEditor`. */
	private readonly pending = new Map<string, string>();
	/**
	 * The node each open panel is currently focused on. The re-scan payload carries it,
	 * so a change to the document cannot silently move the selection back to whatever
	 * node the editor happened to be opened at (design §2.2, §2.4).
	 */
	private readonly selections = new Map<string, string>();
	/**
	 * The normalized condition entries. Without a store (unit tests) they live
	 * for the provider's lifetime only; a real workspace passes a
	 * `ConditionValueStore` over `context.workspaceState`.
	 */
	private conditionEntries: ConditionEntry[];

	constructor(private readonly conditionStore?: ConditionValueStore) {
		this.conditionEntries = conditionStore?.load() ?? [];
	}

	/** The evaluation map, rebuilt from the same normalization `load` applies. */
	private conditionValues(): Map<string, ConditionValue> {
		return parseConditionEntries(this.conditionEntries).values;
	}

	public resolveCustomTextEditor(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): void {
		const key = document.uri.toString();
		this.panels.set(key, panel);

		const reason = gateReason(document.getText(), document.uri.fsPath);
		if (reason) {
			// Explain, then hand the file back to the text editor. Nothing is rendered:
			// `webview.html` is never set, so there is no empty shell to flash.
			void vscode.window.showWarningMessage(reason);
			void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
			panel.onDidDispose(() => this.forget(key));
			return;
		}

		const disposables: vscode.Disposable[] = [];
		const nonce = randomBytes(16).toString('base64');
		const selectedId = this.pending.get(key) ?? this.selections.get(key);
		this.pending.delete(key);
		if (selectedId !== undefined) {
			this.selections.set(key, selectedId);
		}
		let model = scanEcucValues(document.getText());

		panel.webview.options = { enableScripts: true };
		panel.webview.html = renderHtml(model, {
			...editorSettings(),
			conditions: this.conditionValues(),
			conditionEntries: this.conditionEntries.slice(),
			nonce,
			selectedId,
		});

		// A page whose script never runs cannot say so. If the boot message does not
		// arrive, say it here — otherwise a dead page is just a header and an empty
		// tree with no explanation (see the task's PRD).
		const boot = watchBoot(() => {
			void vscode.window.showWarningMessage(
				`"${path.basename(document.uri.fsPath)}" opened, but the ECUC editor page did not start. Run "Developer: Open Webview Developer Tools" to see the error.`
			);
		}, BOOT_TIMEOUT_MS);

		// The single refresh path: any change to this document — an undo, an external
		// edit, or the sibling child's write — re-scans and pushes row data, so no range
		// on screen can outlive the text it points at. The same push serves a settings
		// change, which re-renders the model that is already scanned (parent AC3).
		const push = (): void => {
			const current = this.selections.get(key);
			const options: RenderOptions = {
				...editorSettings(),
				conditions: this.conditionValues(),
				selectedId: current,
			};
			const rowDocument = buildRows(model, options);
			// `type: 'model'` is kept because the details editor clears its pending
			// state on that message; the payload is row data, not full-tree HTML.
			void panel.webview.postMessage({
				type: 'model',
				rows: rowDocument.rows,
				selectedId: current,
			});
		};

		disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() !== key) {
					return;
				}
				model = scanEcucValues(document.getText());
				push();
			})
		);

		// `arxmlScope.ecuc.editor.sort` / `sortExcept` are read at every render, but
		// nothing re-renders an open panel on its own, so without this the setting would
		// only take effect after the document next changed or the editor was reopened.
		disposables.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('arxmlScope.ecuc.editor')) {
					push();
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
					// The page can be reloaded without reopening the panel. The embedded
					// entries are only the first-paint copy; re-post the host's current
					// entries so a reload cannot show (and then save) stale values.
					void panel.webview.postMessage({ type: 'conditions', entries: this.conditionEntries });
					return;
				}
				if (message.type === 'conditions') {
					// A non-array payload is ignored rather than treated as "clear all membership".
					if (!Array.isArray(message.entries)) {
						return;
					}
					const parsed = parseConditionEntries(message.entries);
					this.conditionEntries = parsed.entries;
					void this.conditionStore?.save(parsed.entries);
					if (parsed.invalid.length > 0) {
						const names = parsed.invalid.slice(0, 5).join(', ');
						const more = parsed.invalid.length > 5 ? ` and ${parsed.invalid.length - 5} more` : '';
						void panel.webview.postMessage({
							type: 'notice',
							message: `Ignored ${parsed.invalid.length} invalid condition name${parsed.invalid.length === 1 ? '' : 's'}: ${names}${more}.`,
							kind: 'warn',
							scope: 'conditions',
						});
					}
					push();
					return;
				}
				if (typeof message.nodeId !== 'string') {
					return;
				}
				if (message.type === 'reveal') {
					void this.revealNode(document, model, message.nodeId, panel);
				} else if (message.type === 'follow') {
					void this.followReference(document, model, message.nodeId, panel);
				} else if (message.type === 'edit' && typeof message.value === 'string') {
					const field: EditField = message.field ?? 'value';
					// An unknown field is ignored rather than guessed at.
					if (EDIT_FIELDS.includes(field)) {
						void this.editField(document, panel, message.nodeId, field, message.value);
					}
				} else if (message.type === 'delete') {
					void this.deleteRow(document, panel, message.nodeId);
				} else if (message.type === 'duplicate') {
					void this.duplicateRow(document, panel, message.nodeId);
				} else if (message.type === 'select') {
					// A click in the tree is view state the host must know too: the re-scan
					// payload carries the selection, so without this a document change would
					// move the selection back (UX child design §4.1, AC4).
					this.selections.set(key, message.nodeId);
				}
			})
		);

		panel.onDidDispose(() => {
			boot.dispose();
			for (const disposable of disposables) {
				disposable.dispose();
			}
			this.forget(key);
		});
	}

	/** Releases everything this provider keeps for a document. */
	private forget(key: string): void {
		this.panels.delete(key);
		this.selections.delete(key);
		this.pending.delete(key);
	}

	/**
	 * Opens the custom editor for `uri` with `nodeId` selected, or moves the selection
	 * of the panel that is already showing it (design §2.4, source → editor).
	 */
	public async selectNode(uri: vscode.Uri, nodeId: string): Promise<void> {
		const key = uri.toString();
		const panel = this.panels.get(key);
		if (panel) {
			this.selections.set(key, nodeId);
			panel.reveal();
			await panel.webview.postMessage({ type: 'select', nodeId });
			return;
		}
		this.pending.set(key, nodeId);
		await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
	}

	/**
	 * Reveals a node's range in the source without destroying the custom editor's tab
	 * (UX child design §3). The panel's own column is passed through so the source opens
	 * beside the tree rather than beside whatever happens to be "active".
	 */
	private async revealNode(
		document: vscode.TextDocument,
		model: ReturnType<typeof scanEcucValues>,
		nodeId: string,
		panel: vscode.WebviewPanel
	): Promise<void> {
		const entry = buildNodeIndex(model).byId.get(nodeId);
		if (!entry) {
			return;
		}
		await revealRangeInTextEditor(document, entry.range, { viewColumn: panel.viewColumn });
	}

	private async followReference(
		document: vscode.TextDocument,
		model: ReturnType<typeof scanEcucValues>,
		nodeId: string,
		panel: vscode.WebviewPanel
	): Promise<void> {
		const entry = buildNodeIndex(model).byId.get(nodeId);
		if (!entry || entry.kind !== 'reference') {
			return;
		}
		const result = followReference(model, entry.node as ReferenceNode);
		if (!result.ok) {
			await panel.webview.postMessage({ type: 'notice', message: result.reason, kind: 'warn', scope: 'details' });
			return;
		}
		const index = buildNodeIndex(model);
		const targetId = nodeIdForRange(index, result.range);
		if (!targetId) {
			await panel.webview.postMessage({
				type: 'notice',
				message: 'The same-file target is present but not an ECUC row.',
				kind: 'warn',
				scope: 'details',
			});
			return;
		}
		this.selections.set(document.uri.toString(), targetId);
		panel.reveal();
		await panel.webview.postMessage({ type: 'select', nodeId: targetId });
	}

	/**
	 * Delete one container/parameter after a modal confirmation. The plan is built
	 * against the current bytes; a refusal never writes and reports in Details.
	 */
	private async deleteRow(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
		nodeId: string
	): Promise<void> {
		const text = document.getText();
		const plan = planDelete(scanEcucValues(text), text, nodeId);
		if (!plan.ok) {
			await this.postStructureNotice(panel, plan.reason);
			return;
		}
		const descendants =
			plan.descendants > 0
				? ` Its ${plan.descendants} descendant${plan.descendants === 1 ? '' : 's'} will also be deleted.`
				: '';
		const answer = await vscode.window.showWarningMessage(
			`Delete "${plan.label}"?${descendants} You can undo with Ctrl+Z.`,
			{ modal: true },
			'Delete'
		);
		if (answer !== 'Delete') {
			return;
		}
		const applied = await applyStructureEdit(document, plan.record);
		if (!applied.ok) {
			await this.postStructureNotice(panel, applied.reason);
		}
	}

	/**
	 * Duplicate one container/parameter after a modal confirmation. A container also
	 * asks for a unique short name first; a parameter keeps its DEFINITION-REF, which
	 * is the AUTOSAR multi-instance shape.
	 */
	private async duplicateRow(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
		nodeId: string
	): Promise<void> {
		const initialText = document.getText();
		const initial = planDuplicate(scanEcucValues(initialText), initialText, nodeId);
		if (!initial.ok) {
			await this.postStructureNotice(panel, initial.reason);
			return;
		}
		let name = initial.record.duplicateName;
		if (name !== undefined) {
			const chosen = await vscode.window.showInputBox({
				prompt: 'New short name for the duplicate',
				value: name,
				validateInput: (value) => duplicateNameRefusal(scanEcucValues(document.getText()), nodeId, value),
			});
			if (chosen === undefined) {
				return;
			}
			name = chosen.trim();
		}
		const text = document.getText();
		const plan = planDuplicate(scanEcucValues(text), text, nodeId, name);
		if (!plan.ok) {
			await this.postStructureNotice(panel, plan.reason);
			return;
		}
		const message =
			name === undefined
				? `Duplicate parameter "${plan.label}"?`
				: `Duplicate "${plan.label}" as "${name}"?`;
		const answer = await vscode.window.showWarningMessage(
			`${message} You can undo with Ctrl+Z.`,
			{ modal: true },
			'Duplicate'
		);
		if (answer !== 'Duplicate') {
			return;
		}
		const applied = await applyStructureEdit(document, plan.record);
		if (!applied.ok) {
			await this.postStructureNotice(panel, applied.reason);
		}
	}

	private async postStructureNotice(panel: vscode.WebviewPanel, message: string): Promise<void> {
		await panel.webview.postMessage({
			type: 'notice',
			message,
			kind: 'warn',
			scope: 'details',
		});
	}

	/**
	 * The write path (child design §2.3, §2.5): validate against a fresh scan, refuse
	 * with a `notice` and no mutation, or apply exactly one `WorkspaceEdit`. A refusal
	 * carries `inline: true`: the details panel shows it beside the field, and the page
	 * keeps it out of the toolbar notice unless that panel is hidden.
	 *
	 * A container rename changes the path-based id the panel is selected by, so the
	 * predicted id is stored **before** the write: the `onDidChangeTextDocument` push that
	 * follows then already carries the surviving id. A refusal restores the previous
	 * selection entry, so a refused edit cannot move the selection on its own.
	 *
	 * The refresh after a successful write is the existing `onDidChangeTextDocument`
	 * subscription — it re-scans and pushes the tree. Pushing here as well would be a
	 * second update path for one change, which `rescan.test.ts` counts against the
	 * platform's own events.
	 */
	private async editField(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
		nodeId: string,
		field: EditField,
		value: string
	): Promise<void> {
		const key = document.uri.toString();
		const text = document.getText();
		const model = scanEcucValues(text);
		const plan =
			field === 'value' ? buildEdit(model, text, nodeId, value) : buildFieldEdit(model, text, nodeId, field, value);
		if (!plan.ok) {
			await panel.webview.postMessage({ type: 'notice', message: plan.reason, kind: 'warn', inline: true, scope: 'details' });
			return;
		}
		const previous = this.selections.get(key);
		if (plan.nextNodeId !== undefined && plan.nextNodeId !== nodeId) {
			this.selections.set(key, plan.nextNodeId);
		}
		const applied = await applyEdit(document, plan.record);
		if (!applied.ok) {
			if (previous === undefined) {
				this.selections.delete(key);
			} else {
				this.selections.set(key, previous);
			}
			await panel.webview.postMessage({ type: 'notice', message: applied.reason, kind: 'warn', inline: true, scope: 'details' });
		}
	}
}
