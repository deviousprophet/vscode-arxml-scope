// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { ConditionValueStore } from './host/conditionValues';
import { EcucEditorProvider, VIEW_TYPE } from './host/ecucEditorProvider';
import { CompareSelectionStore } from './host/compareSelection';
import { IndexService } from './host/indexService';
import { ValidationService } from './host/validationService';
import { registerTextFeatures } from './host/textFeatures';
import { resolveEngine } from './host/engine/nativeLoader';
import type { CoreEngine } from './host/engine/coreEngine';
import type { IndexStats } from './core/index/indexModel';

/**
 * The small surface the extension exposes to integration tests and cross-file
 * features. It is intentionally read-only except for `reindex`.
 */
export interface ArxmlScopeApi {
	indexStats(): IndexStats;
	statusBarText(): string;
	reindex(): Promise<void>;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): ArxmlScopeApi {
	// Resolve the required engine before registering any service: a bad addon
	// fails activation without leaving partial registrations behind.
	let resolvedEngine: CoreEngine;
	try {
		resolvedEngine = resolveEngine(context.extensionPath);
	} catch (error) {
		void vscode.window.showErrorMessage(
			`ARXML Scope: ${error instanceof Error ? error.message : String(error)}`
		);
		throw error;
	}
	context.subscriptions.push({ dispose: () => resolvedEngine.dispose() });

	// The workspace index is in memory only. It starts in the background so a large
	// workspace never delays activation.
	const indexService = new IndexService();
	context.subscriptions.push(indexService);
	indexService.start();
	const validationService = new ValidationService(indexService);
	context.subscriptions.push(validationService);
	registerTextFeatures(context, indexService);
	// The ECUC editor. `priority: "option"` in the manifest is what keeps a normally
	// opened `.arxml` in the text editor: the view is reachable only
	// through the command, the menu entry, or *Open With…*.
	// Condition values are per-workspace state, never a file beside the ARXML.
	const ecucProvider = new EcucEditorProvider(
		new ConditionValueStore(context.workspaceState),
		context.extensionUri,
		indexService
	);
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(VIEW_TYPE, ecucProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);
	registerCommands(context, ecucProvider, new CompareSelectionStore(), indexService);
	return {
		indexStats: () => indexService.stats(),
		statusBarText: () => indexService.statusText(),
		reindex: () => indexService.rebuild(),
	};
}

// This method is called when your extension is deactivated
export function deactivate() {}
