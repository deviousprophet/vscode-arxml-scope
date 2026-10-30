// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { ConditionValueStore } from './editor/conditionValues';
import { EcucEditorProvider, VIEW_TYPE } from './editor/ecucEditorProvider';
import { CompareSelectionStore } from './diff/compareSelection';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// The ECUC editor. `priority: "option"` in the manifest is what keeps a normally
	// opened `.arxml` in the text editor (parent D14, AC3): the view is reachable only
	// through the command, the menu entry, or *Open With…*.
	// Condition values are per-workspace state, never a file beside the ARXML.
	const ecucProvider = new EcucEditorProvider(new ConditionValueStore(context.workspaceState));
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(VIEW_TYPE, ecucProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);
	registerCommands(context, ecucProvider, new CompareSelectionStore());
}

// This method is called when your extension is deactivated
export function deactivate() {}
