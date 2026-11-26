/**
 * Extension-host spike, part 2: runs inside the real VS Code extension host.
 *
 * Opens the two fixture files and executes the public compare command. Then it
 * runs the Playwright CDP capture in a child process while the webview is alive.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'deviousprophet.vscode-arxml-scope';
const OUT = process.env.PREVIEW_OUT ?? path.resolve(process.cwd(), '.out', 'extension-host');
const WORKSPACE = process.env.PREVIEW_WORKSPACE;
const PORT = process.env.PREVIEW_CDP_PORT ?? '9222';

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture() {
	const script = path.resolve(__dirname, 'cdpCapture.mjs');
	const child = spawn(process.execPath, [script], {
		env: { ...process.env, PREVIEW_CDP_PORT: PORT, PREVIEW_OUT: OUT },
		stdio: 'inherit'
	});
	const code = await new Promise((resolve) => child.on('exit', resolve));
	if (code !== 0) {
		throw new Error(`cdpCapture exited ${String(code)}`);
	}
}

async function openDiffWebview() {
	const left = vscode.Uri.file(path.join(WORKSPACE, 'left.arxml'));
	const right = vscode.Uri.file(path.join(WORKSPACE, 'right.arxml'));
	await vscode.workspace.openTextDocument(left);
	await vscode.workspace.openTextDocument(right);
	await vscode.commands.executeCommand('vscode-arxml-scope.compareSelected', left, [right]);
	// The panel is created asynchronously by the command; wait for a webview tab.
	for (let i = 0; i < 80; i += 1) {
		const webviewTab = vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.find((tab) => {
				const input = tab.input;
				return (
					input instanceof vscode.TabInputWebview ||
					(input && typeof input === 'object' && 'viewType' in input)
				);
			});
		if (webviewTab) {
			return webviewTab.label;
		}
		await delay(250);
	}
	throw new Error('no webview tab appeared after compareSelected');
}

async function run() {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	if (!extension) {
		throw new Error(`extension ${EXTENSION_ID} was not loaded`);
	}
	const started = Date.now();
	await extension.activate();
	const label = await openDiffWebview();
	const openedMs = Date.now() - started;
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(
		path.join(OUT, 'opened.json'),
		`${JSON.stringify({ extension: EXTENSION_ID, tab: label, openedMs }, null, 2)}\n`
	);
	await capture();
}

module.exports = { run };
