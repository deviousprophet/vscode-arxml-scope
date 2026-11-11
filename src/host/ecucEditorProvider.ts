/**
 * The ECUC custom text editor.
 *
 * `resolveCustomTextEditor` runs once per panel. Order matters: the gate completes
 * before any HTML is set, so a refused file never flashes an empty tree.
 *
 * `CustomTextEditorProvider` has no `openCustomDocument`, no
 * `onDidChangeCustomDocument` and no save/revert hooks — undo, redo, dirty state and
 * save belong to the real `TextDocument`. The one write this provider performs goes
 * through `WorkspaceEdit` onto that document, so it participates in that history
 */
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { isArxmlPath, isEcucValues } from '../core/ecuc/detect';
import { ReferenceNode, SortMode } from '../core/ecuc/model';
import { SORT_EXCEPTIONS } from '../core/ecuc/order';
import { scanEcucValues } from '../core/ecuc/scanner';
import type { ConditionEntry } from '../core/ecuc/conditionEntry';
import { ConditionValue } from '../core/ecuc/syscond';
import { ConditionValueStore, parseConditionEntries } from './conditionValues';
import { buildRows, RowBuildOptions } from '../core/ecuc/renderRows';
import { buildNodeIndex } from '../core/ecuc/nodeId';
import type { NodeEntry } from '../core/ecuc/nodeId';
import { applyEdit, buildEdit, buildFieldEdit } from './ecucEdit';
import {
	applyStructureEdit,
	duplicateNameRefusal,
	planDelete,
	planDuplicate,
} from './ecucStructureEdit';
import { followReference, nodeIdForRange, revealRangeInTextEditor } from './navigation';
import { watchBoot } from './bootWatchdog';
import type { BootWatchdog } from './bootWatchdog';
import { editorShell } from './webviewShell';
import { editorMessageType, documentHeader } from '../webviewProtocol';
import type { EditorWebviewToProvider } from '../webviewProtocol';
import type { DefinitionInfo } from '../core/index/definitions';
import type { IndexElement, IndexReference } from '../core/index/indexModel';
import type { ElementResolution } from '../core/index/workspaceIndex';

export const VIEW_TYPE = 'vscode-arxml-scope.ecucEditor';

/**
 * The index surface the provider needs. `IndexService` implements it; the
 * provider stays independent of the host service's lifecycle.
 */
export interface DefinitionSource {
	definition(definitionRef: string): DefinitionInfo | undefined;
	definitionCandidateCount?(definitionRef: string): number;
	subscribe(listener: () => void): { dispose(): void };
	resolveTarget?(targetPath: string, targetDest?: string, sourceFile?: string): ElementResolution;
	referencesFor?(target: IndexElement): IndexReference[];
}

/** How long a panel may take to report `ready` before the host warns. */
const BOOT_TIMEOUT_MS = 10_000;

/** The field a `type: 'edit'` message targets; absent means the parameter `<VALUE>`. */
type EditField = 'value' | 'shortName' | 'definitionRef';

const EDIT_FIELDS: readonly EditField[] = ['value', 'shortName', 'definitionRef'];

/** The per-panel state one page message may read or update. */
interface EditorSession {
	document: vscode.TextDocument;
	panel: vscode.WebviewPanel;
	key: string;
	boot: BootWatchdog;
	model(): ReturnType<typeof scanEcucValues>;
	push(): void;
}

/** A reference chosen in the Quick Pick plus the document it was opened from. */
interface PickedReference {
	document: vscode.TextDocument;
	reference: IndexReference;
}

/** A resolved `referencesFor`, or `undefined` when the workspace index is absent. */
type ReferenceLookup = (target: IndexElement) => IndexReference[];

type NavigationMessage = Extract<EditorWebviewToProvider, { type: 'reveal' | 'follow' | 'references' }>;

/**
 * Why a document cannot be rendered, or `undefined` when it can.
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
	 * node the editor happened to be opened at.
	 */
	private readonly selections = new Map<string, string>();
	/**
	 * The normalized condition entries. Without a store (unit tests) they live
	 * for the provider's lifetime only; a real workspace passes a
	 * `ConditionValueStore` over `context.workspaceState`.
	 */
	private conditionEntries: ConditionEntry[];
	/** Persists the normalized condition entries; absent in unit tests. */
	private readonly conditionStore?: ConditionValueStore;
	/** The extension root, for `asWebviewUri` on the bundled page assets. */
	private readonly extensionUri: vscode.Uri;
	/** Definition lookup and change notifications; absent in unit tests. */
	private readonly definitionSource?: DefinitionSource;

	constructor(conditionStore?: ConditionValueStore, extensionUri?: vscode.Uri, definitionSource?: DefinitionSource) {
		this.conditionStore = conditionStore;
		this.conditionEntries = conditionStore?.load() ?? [];
		this.extensionUri =
			extensionUri ??
			vscode.extensions.getExtension('deviousprophet.vscode-arxml-scope')?.extensionUri ??
			vscode.Uri.file(path.join(__dirname, '..'));
		this.definitionSource = definitionSource;
	}

	/** The editor page's static shell plus its bundled script/style URIs. */
	private html(webview: vscode.Webview): string {
		const cspSource = webview.cspSource || 'https://webview.test';
		const asset = (name: string): string =>
			typeof webview.asWebviewUri === 'function'
				? webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', name)).toString()
				: `https://webview.test/${name}`;
		return editorShell({
			cspSource,
			scriptUri: asset('editorViewer.js'),
			styleUri: asset('editorViewer.css'),
			nonce: randomBytes(16).toString('base64'),
		});
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
		this.resumeSelection(key);
		let model = scanEcucValues(document.getText());

		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};
		panel.webview.html = this.html(panel.webview);

		// A page whose script never runs cannot say so. If the boot message does not
		// arrive, say it here — otherwise a dead page is just a header and an empty
		// tree with no explanation.
		const boot = watchBoot(() => {
			void vscode.window.showWarningMessage(
				`"${path.basename(document.uri.fsPath)}" opened, but the ECUC editor page did not start. Run "Developer: Open Webview Developer Tools" to see the error.`
			);
		}, BOOT_TIMEOUT_MS);

		// The single refresh path: any change to this document — an undo, an external
		// edit, or the sibling child's write — re-scans and pushes row data, so no range
		// on screen can outlive the text it points at. The same push serves a settings
		// change, which re-renders the model that is already scanned.
		const push = (): void => {
			const current = this.selections.get(key);
			const options: RowBuildOptions = {
				...editorSettings(),
				conditions: this.conditionValues(),
				...(this.definitionSource === undefined
					? {}
					: { definitions: (ref: string) => this.definitionSource!.definition(ref) }),
				...(this.definitionSource?.definitionCandidateCount === undefined
					? {}
					: { ambiguousDefinitions: (ref: string) => this.definitionSource!.definitionCandidateCount!(ref) }),
				...(this.definitionSource?.resolveTarget === undefined
					? {}
					: {
							referenceResolver: (targetPath: string, targetDest?: string) => {
								const resolution = this.definitionSource!.resolveTarget!(targetPath, targetDest, key);
								return resolution.ok
									? { followable: true }
									: { followable: false, reason: refusalReason(resolution, targetPath) };
							},
						}),
			};
			const rowDocument = buildRows(model, options);
			// The page owns the row store; a re-scan replaces it without markup.
			void panel.webview.postMessage({
				type: 'document',
				document: {
					rows: rowDocument.rows,
					selectedId: current,
					header: documentHeader(model),
				},
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

		// A definition file saved elsewhere changes the details of an already open
		// panel; the subscription is owned by the panel, so closing it stops the push.
		if (this.definitionSource !== undefined) {
			disposables.push(this.definitionSource.subscribe(() => push()));
		}

		const session: EditorSession = {
			document,
			panel,
			key,
			boot,
			model: () => model,
			push,
		};

		disposables.push(
			panel.webview.onDidReceiveMessage((raw: unknown) => this.handlePanelMessage(raw, session))
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

	/** Consumes a pending selection for a panel that just opened, or restores the last one. */
	private resumeSelection(key: string): void {
		const selectedId = this.pending.get(key) ?? this.selections.get(key);
		this.pending.delete(key);
		if (selectedId !== undefined) {
			this.selections.set(key, selectedId);
		}
	}

	/** One page message: protocol guard, session messages, then node-id messages. */
	private handlePanelMessage(raw: unknown, session: EditorSession): void {
		if (!editorMessageType(raw)) {
			return;
		}
		const message = raw as EditorWebviewToProvider;
		if (this.handleSessionMessage(message, session)) {
			return;
		}
		this.handleNodeMessage(message, session);
	}

	/** Handles the messages that carry no node id; true when one matched. */
	private handleSessionMessage(message: EditorWebviewToProvider, session: EditorSession): boolean {
		if (message.type === 'ready') {
			this.handleReady(session);
			return true;
		}
		if (message.type === 'conditions') {
			this.handleConditions(message, session);
			return true;
		}
		return false;
	}

	private handleReady(session: EditorSession): void {
		session.boot.settle();
		// The page can be reloaded without reopening the panel; re-post the
		// host's current entries and the row document so a reload cannot show
		// stale values or an empty tree.
		void session.panel.webview.postMessage({ type: 'conditions', entries: this.conditionEntries });
		session.push();
	}

	private handleConditions(
		message: Extract<EditorWebviewToProvider, { type: 'conditions' }>,
		session: EditorSession
	): void {
		// A non-array payload is ignored rather than treated as "clear all membership".
		if (!Array.isArray(message.entries)) {
			return;
		}
		const parsed = parseConditionEntries(message.entries);
		this.conditionEntries = parsed.entries;
		void this.conditionStore?.save(parsed.entries);
		if (parsed.invalid.length > 0) {
			void session.panel.webview.postMessage({
				type: 'notice',
				message: invalidConditionsText(parsed.invalid),
				kind: 'warn',
				scope: 'conditions',
			});
		}
		session.push();
	}

	/** Dispatches one node-id message: navigation first, then edits and structure. */
	private handleNodeMessage(message: EditorWebviewToProvider, session: EditorSession): void {
		const nodeId = messageNodeId(message);
		if (nodeId === undefined) {
			return;
		}
		if (isNavigationMessage(message)) {
			void this.handleNavigation(message, nodeId, session);
			return;
		}
		if (message.type === 'edit') {
			this.handleEditMessage(message, nodeId, session);
			return;
		}
		this.handleStructureMessage(message, nodeId, session);
	}

	private async handleNavigation(
		message: NavigationMessage,
		nodeId: string,
		session: EditorSession
	): Promise<void> {
		const model = session.model();
		if (message.type === 'reveal') {
			await this.revealEntry(model, nodeId, session);
			return;
		}
		if (message.type === 'follow') {
			await this.followEntry(model, nodeId, session);
			return;
		}
		// A stale id keeps the old no-path notice instead of silently doing nothing.
		await this.findReferences(session.document, this.nodeEntry(model, nodeId), session.panel);
	}

	private async revealEntry(
		model: ReturnType<typeof scanEcucValues>,
		nodeId: string,
		session: EditorSession
	): Promise<void> {
		const entry = this.nodeEntry(model, nodeId);
		if (entry !== undefined) {
			await this.revealNode(session.document, entry, session.panel);
		}
	}

	private async followEntry(
		model: ReturnType<typeof scanEcucValues>,
		nodeId: string,
		session: EditorSession
	): Promise<void> {
		const entry = this.nodeEntry(model, nodeId);
		if (entry !== undefined) {
			await this.followReference(session.document, model, entry, session.panel);
		}
	}

	private handleEditMessage(
		message: Extract<EditorWebviewToProvider, { type: 'edit' }>,
		nodeId: string,
		session: EditorSession
	): void {
		if (typeof message.value !== 'string') {
			return;
		}
		const field: EditField = message.field ?? 'value';
		// An unknown field is ignored rather than guessed at.
		if (EDIT_FIELDS.includes(field)) {
			void this.editField(session.document, session.panel, nodeId, field, message.value);
		}
	}

	private handleStructureMessage(
		message: EditorWebviewToProvider,
		nodeId: string,
		session: EditorSession
	): void {
		if (message.type === 'delete') {
			void this.deleteRow(session.document, session.panel, nodeId);
		} else if (message.type === 'duplicate') {
			void this.duplicateRow(session.document, session.panel, nodeId);
		} else if (message.type === 'select') {
			// A click in the tree is view state the host must know too: the re-scan
			// payload carries the selection, so without this a document change would
			// move the selection back.
			this.selections.set(session.key, nodeId);
		}
	}

	/**
	 * Opens the custom editor for `uri` with `nodeId` selected, or moves the selection
	 * of the panel that is already showing it.
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

	/** Resolves a page's node id against the current model; a stale id yields undefined. */
	private nodeEntry(
		model: ReturnType<typeof scanEcucValues>,
		nodeId: string
	): NodeEntry | undefined {
		return buildNodeIndex(model).byId.get(nodeId);
	}

	/**
	 * Reveals a node's range in the source without destroying the custom editor's tab.
	 * The panel's own column is passed through so the source opens
	 * beside the tree rather than beside whatever happens to be "active".
	 */
	private async revealNode(
		document: vscode.TextDocument,
		entry: NodeEntry,
		panel: vscode.WebviewPanel
	): Promise<void> {
		await revealRangeInTextEditor(document, entry.range, { viewColumn: panel.viewColumn });
	}

	private async followReference(
		document: vscode.TextDocument,
		model: ReturnType<typeof scanEcucValues>,
		entry: NodeEntry,
		panel: vscode.WebviewPanel
	): Promise<void> {
		if (entry.kind !== 'reference') {
			return;
		}
		const reference = entry.node as ReferenceNode;
		const raw = reference.targetRawPath ?? '';
		const workspace = this.resolveWorkspaceTarget(document, raw, reference.targetDest);
		if (await this.followInWorkspace(document, model, raw, workspace, panel)) {
			return;
		}
		// No workspace index, or no row for the resolved range: keep the same-file behaviour.
		await this.followSameFile(document, model, reference, panel);
	}

	/** The workspace resolution for one target, when the host supplies an index. */
	private resolveWorkspaceTarget(
		document: vscode.TextDocument,
		raw: string,
		targetDest: string | undefined
	): ElementResolution | undefined {
		return this.definitionSource?.resolveTarget?.(raw, targetDest, document.uri.toString());
	}

	/** True when the workspace resolution owns the outcome, including a refusal notice. */
	private async followInWorkspace(
		document: vscode.TextDocument,
		model: ReturnType<typeof scanEcucValues>,
		raw: string,
		workspace: ElementResolution | undefined,
		panel: vscode.WebviewPanel
	): Promise<boolean> {
		if (workspace === undefined) {
			return false;
		}
		if (!workspace.ok) {
			await this.postStructureNotice(panel, refusalReason(workspace, raw));
			return true;
		}
		const target = await this.pickWorkspaceTarget(workspace, raw);
		if (target === undefined) {
			return true;
		}
		return this.revealWorkspaceTarget(document, model, target, panel);
	}

	/** The canonical element, or the copy the user picked from a multi-copy target. */
	private async pickWorkspaceTarget(
		resolution: Extract<ElementResolution, { ok: true }>,
		raw: string
	): Promise<IndexElement | undefined> {
		if (resolution.copies.length <= 1) {
			return resolution.element;
		}
		const items: Array<vscode.QuickPickItem & { copy: IndexElement }> = [];
		for (const copy of resolution.copies) {
			const uri = vscode.Uri.parse(copy.file);
			const copyDocument = await vscode.workspace.openTextDocument(uri);
			items.push({
				label: `${path.basename(uri.fsPath)}:${copyDocument.positionAt(copy.range.start).line + 1}`,
				copy,
			});
		}
		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: `Copies of "${raw}"`,
		});
		return picked?.copy;
	}

	/** True when the target was selected in this panel or opened in another editor. */
	private async revealWorkspaceTarget(
		document: vscode.TextDocument,
		model: ReturnType<typeof scanEcucValues>,
		target: IndexElement,
		panel: vscode.WebviewPanel
	): Promise<boolean> {
		if (target.file !== document.uri.toString()) {
			await this.openElement(target, panel);
			return true;
		}
		const targetId = nodeIdForRange(buildNodeIndex(model), target.range);
		if (!targetId) {
			return false;
		}
		this.selections.set(document.uri.toString(), targetId);
		panel.reveal();
		await panel.webview.postMessage({ type: 'select', nodeId: targetId });
		return true;
	}

	/** The pre-index behaviour: resolve the reference inside this model. */
	private async followSameFile(
		document: vscode.TextDocument,
		model: ReturnType<typeof scanEcucValues>,
		reference: ReferenceNode,
		panel: vscode.WebviewPanel
	): Promise<void> {
		const result = followReference(model, reference);
		if (!result.ok) {
			await panel.webview.postMessage({ type: 'notice', message: result.reason, kind: 'warn', scope: 'details' });
			return;
		}
		const targetId = nodeIdForRange(buildNodeIndex(model), result.range);
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
	 * Opens a resolved target. An ECUC-Values target opens in this custom editor
	 * at the row; any other ARXML target opens in the text editor at its range.
	 */
	private async openElement(element: IndexElement, panel: vscode.WebviewPanel): Promise<void> {
		const uri = vscode.Uri.parse(element.file);
		const targetDocument = await vscode.workspace.openTextDocument(uri);
		if (isEcucValues(targetDocument.getText(), uri.fsPath)) {
			const targetModel = scanEcucValues(targetDocument.getText());
			const targetId = nodeIdForRange(buildNodeIndex(targetModel), element.range);
			if (targetId !== undefined) {
				await this.selectNode(uri, targetId);
				return;
			}
		}
		await revealRangeInTextEditor(targetDocument, element.range, { viewColumn: panel.viewColumn });
	}

	/** Lists every indexed reference that resolves to the selected module/container. */
	private async findReferences(
		document: vscode.TextDocument,
		entry: NodeEntry | undefined,
		panel: vscode.WebviewPanel
	): Promise<void> {
		const targetEntry = await this.requireReferenceEntry(entry, panel);
		if (targetEntry === undefined) {
			return;
		}
		const lookup = this.referenceLookup();
		if (lookup === undefined) {
			await this.postStructureNotice(panel, 'The workspace index is unavailable; no cross-file references to list.');
			return;
		}
		const references = lookup(indexedTarget(document, targetEntry));
		const picked = await this.pickReferences(references, targetEntry.label, panel);
		if (picked === undefined) {
			return;
		}
		await revealRangeInTextEditor(picked.document, picked.reference.range, { viewColumn: panel.viewColumn });
	}

	/** The entry when it can carry references; otherwise the Details notice was posted. */
	private async requireReferenceEntry(
		entry: NodeEntry | undefined,
		panel: vscode.WebviewPanel
	): Promise<(NodeEntry & { path: string }) | undefined> {
		if (!isReferenceTarget(entry)) {
			await this.postStructureNotice(panel, 'Find references needs a module or container with an AR path.');
			return undefined;
		}
		return entry;
	}

	/** The index's reference lookup bound to its service, or nothing when unavailable. */
	private referenceLookup(): ReferenceLookup | undefined {
		const source = this.definitionSource;
		if (source === undefined || source.referencesFor === undefined) {
			return undefined;
		}
		const lookup = source.referencesFor.bind(source);
		return (target) => lookup(target);
	}

	/** Shows the reference list and opens the chosen range. */
	private async pickReferences(
		references: readonly IndexReference[],
		label: string,
		panel: vscode.WebviewPanel
	): Promise<PickedReference | undefined> {
		if (references.length === 0) {
			await this.postStructureNotice(panel, `No references found for "${label}".`);
			return undefined;
		}
		const documents = new Map<string, vscode.TextDocument>();
		const items: Array<vscode.QuickPickItem & { reference: IndexReference }> = [];
		for (const reference of references) {
			const targetDocument = await referenceDocument(documents, reference.file);
			items.push(referenceItem(targetDocument, reference));
		}
		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: `References to "${label}"`,
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (picked === undefined) {
			return undefined;
		}
		return pickedReference(documents, picked);
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
	 * The write path: validate against a fresh scan, refuse
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

/** The user-facing summary of ignored condition names, first five then a count. */
function invalidConditionsText(invalid: readonly string[]): string {
	const names = invalid.slice(0, 5).join(', ');
	const more = invalid.length > 5 ? ` and ${invalid.length - 5} more` : '';
	return `Ignored ${invalid.length} invalid condition name${invalid.length === 1 ? '' : 's'}: ${names}${more}.`;
}

/** The page's node id, when the message carries one. */
function messageNodeId(message: EditorWebviewToProvider): string | undefined {
	return 'nodeId' in message && typeof message.nodeId === 'string' ? message.nodeId : undefined;
}

/** The messages that navigate the source editor or the reference list. */
function isNavigationMessage(message: EditorWebviewToProvider): message is NavigationMessage {
	return message.type === 'reveal' || message.type === 'follow' || message.type === 'references';
}

/** True for a row that can carry an AR path and therefore have references. */
function isReferenceTarget(entry: NodeEntry | undefined): entry is NodeEntry & { path: string } {
	return entry !== undefined && entry.path !== undefined;
}

/** The index element shape a row contributes to `referencesFor`. */
function indexedTarget(document: vscode.TextDocument, entry: NodeEntry & { path: string }): IndexElement {
	return {
		kind: entry.kind === 'module' ? 'module' : 'container',
		path: entry.path,
		file: document.uri.toString(),
		range: entry.range,
	};
}

/** The already-opened document for a URI, or a fresh open cached for the next reference. */
async function referenceDocument(
	documents: Map<string, vscode.TextDocument>,
	file: string
): Promise<vscode.TextDocument> {
	const known = documents.get(file);
	if (known !== undefined) {
		return known;
	}
	const opened = await vscode.workspace.openTextDocument(vscode.Uri.parse(file));
	documents.set(file, opened);
	return opened;
}

/** One quick-pick item for a cross-file reference. */
function referenceItem(
	targetDocument: vscode.TextDocument,
	reference: IndexReference
): vscode.QuickPickItem & { reference: IndexReference } {
	const line = targetDocument.positionAt(reference.range.start).line + 1;
	return {
		label: `${path.basename(targetDocument.uri.fsPath)}:${line}`,
		description: reference.definitionRef ?? reference.targetRawPath ?? '',
		detail: reference.sourcePath,
		reference,
	};
}

/** The picked item plus its already-opened document. */
function pickedReference(
	documents: Map<string, vscode.TextDocument>,
	picked: vscode.QuickPickItem & { reference: IndexReference }
): PickedReference | undefined {
	const targetDocument = documents.get(picked.reference.file);
	if (targetDocument === undefined) {
		return undefined;
	}
	return { document: targetDocument, reference: picked.reference };
}

/** A follow refusal in the user's terms; never exposes an internal enum. */
function refusalReason(resolution: Extract<ElementResolution, { ok: false }>, rawPath: string): string {
	switch (resolution.reason) {
		case 'absent':
			return `No workspace target for "${rawPath}".`;
		case 'ambiguous':
			return `Target "${rawPath}" is ambiguous; no file was opened.`;
		case 'dest-mismatch':
			return `Target "${rawPath}" is a ${resolution.actualKind}, not the type the reference expects.`;
	}
}
