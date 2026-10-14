// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { SpikeEditorProvider } from './spikes/spikeProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-arxml-scope" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('vscode-arxml-scope.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from ARXML Scope!');
	});

	context.subscriptions.push(disposable);

	// THROWAWAY — Step 0 spike scaffolding. Delete together with `src/spikes/` and `spike/` once
	// Spike A and Spike B are answered; see
	// `.trellis/tasks/10-14-ecuc-artext-editor/research/spike-results.md`.
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(SpikeEditorProvider.viewType, new SpikeEditorProvider(), {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand('vscode-arxml-scope.spike.open', async (uri?: vscode.Uri) => {
			const target = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (!target) {
				void vscode.window.showInformationMessage('Open a *.spike.arxml file first.');
				return;
			}
			await vscode.commands.executeCommand('vscode.openWith', target, SpikeEditorProvider.viewType);
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
