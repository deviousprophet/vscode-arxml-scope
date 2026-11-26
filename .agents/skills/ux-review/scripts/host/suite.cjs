/**
 * In-host suite for the UX review.
 *
 * Runs inside the Extension Development Host. It activates the extension,
 * serves a tiny localhost bridge for the Playwright driver and runs the driver
 * as a child process while the window is alive. The bridge is test-only and
 * bound to 127.0.0.1.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'deviousprophet.vscode-arxml-scope';
const OUT = process.env.HOST_OUT;
const WORKSPACE = process.env.HOST_WORKSPACE;
const CDP_PORT = process.env.HOST_CDP_PORT;
const MODE = process.env.HOST_MODE ?? 'normal';

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function revive(value) {
	if (Array.isArray(value)) {
		return value.map(revive);
	}
	if (value && typeof value === 'object') {
		if (value.kind === 'uri' && typeof value.path === 'string') {
			return vscode.Uri.file(value.path);
		}
		const out = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = revive(item);
		}
		return out;
	}
	return value;
}

function tabInfo(tab) {
	if (!tab) {
		return null;
	}
	const input = tab.input;
	const viewType = input && typeof input === 'object' && 'viewType' in input ? input.viewType : undefined;
	const uri = input && typeof input === 'object' && 'uri' in input ? input.uri : undefined;
	return {
		label: tab.label,
		viewType,
		uri: uri && typeof uri.fsPath === 'string' ? uri.fsPath : undefined,
		dirty: tab.isDirty
	};
}

function allTabs() {
	return vscode.window.tabGroups.all.flatMap((group) => group.tabs.map(tabInfo));
}

function textDocumentFor(fsPath) {
	const uri = vscode.Uri.file(fsPath);
	return vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
}

async function handle(request, body) {
	switch (request.url) {
		case '/health':
			return { ok: true, extensionActive: true, mode: MODE };
		case '/state': {
			const active = vscode.window.tabGroups.activeTabGroup.activeTab;
			const activeEditor = vscode.window.activeTextEditor;
			return {
				activeTab: tabInfo(active),
				activeTextEditor: activeEditor ? activeEditor.document.uri.fsPath : null,
				tabs: allTabs(),
				folders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []
			};
		}
		case '/exec': {
			const args = revive(body.args ?? []);
			if (body.detached) {
				Promise.resolve(vscode.commands.executeCommand(body.command, ...args)).catch(() => {});
				return { ok: true, detached: true };
			}
			const result = await vscode.commands.executeCommand(body.command, ...args);
			return { ok: true, result: result === undefined ? null : result };
		}
		case '/openWith': {
			const uri = vscode.Uri.file(body.path);
			await vscode.commands.executeCommand('vscode.openWith', uri, body.viewType);
			return { ok: true };
		}
		case '/openText': {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(body.path));
			await vscode.window.showTextDocument(document, { preview: false });
			return { ok: true };
		}
		case '/closeAll': {
			try {
				await vscode.workspace.saveAll(false);
			} catch {
				// A refused save must not strand the run; the driver records stay-dirty state.
			}
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await delay(300);
			return { ok: true };
		}
		case '/setting': {
			const config = vscode.workspace.getConfiguration(body.section);
			await config.update(body.key, body.value, vscode.ConfigurationTarget.Workspace);
			return { ok: true, value: body.value };
		}
		case '/config': {
			const config = vscode.workspace.getConfiguration(body.section);
			return { ok: true, value: config.get(body.key) };
		}
		case '/hasCommand': {
			const commands = await vscode.commands.getCommands(true);
			return { ok: true, has: commands.includes(body.command) };
		}
		case '/writeFile': {
			fs.writeFileSync(body.path, body.content, 'utf8');
			return { ok: true };
		}
		case '/readFile': {
			return { ok: true, content: fs.readFileSync(body.path, 'utf8') };
		}
		case '/deleteFile': {
			fs.rmSync(body.path, { force: true });
			return { ok: true };
		}
		case '/vscodeDelete': {
			await vscode.workspace.fs.delete(vscode.Uri.file(body.path), { recursive: false, useTrash: false });
			await delay(400);
			return { ok: true };
		}
		case '/replaceDocument': {
			const uri = vscode.Uri.file(body.path);
			const document = await vscode.workspace.openTextDocument(uri);
			const edit = new vscode.WorkspaceEdit();
			const full = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
			edit.replace(uri, full, body.content);
			const applied = await vscode.workspace.applyEdit(edit);
			await delay(body.waitMs ?? 250);
			return { ok: applied, version: textDocumentFor(body.path)?.version ?? null };
		}
		case '/save': {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(body.path));
			const saved = await document.save();
			return { ok: saved, dirty: textDocumentFor(body.path)?.isDirty ?? null };
		}
		case '/saveAll': {
			const saved = await vscode.workspace.saveAll(false);
			return { ok: saved };
		}
		case '/sleep': {
			await delay(body.ms ?? 250);
			return { ok: true };
		}
		default:
			return { ok: false, error: `unknown route ${request.url}` };
	}
}

function startBridge() {
	return new Promise((resolve, reject) => {
		const server = http.createServer((request, response) => {
			const chunks = [];
			request.on('data', (chunk) => chunks.push(chunk));
			request.on('end', () => {
				let body = {};
				try {
					body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
				} catch (error) {
					response.writeHead(400, { 'content-type': 'application/json' });
					response.end(JSON.stringify({ ok: false, error: `bad json: ${String(error)}` }));
					return;
				}
				handle(request, body)
					.then((result) => {
						response.writeHead(200, { 'content-type': 'application/json' });
						response.end(JSON.stringify(result));
					})
					.catch((error) => {
						response.writeHead(500, { 'content-type': 'application/json' });
						response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
					});
			});
		});
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
	});
}

function runDriver(bridgePort) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [path.join(__dirname, 'driver.mjs')], {
			env: {
				...process.env,
				HOST_BRIDGE_PORT: String(bridgePort),
				HOST_CDP_PORT: CDP_PORT,
				HOST_OUT: OUT,
				HOST_WORKSPACE: WORKSPACE,
				HOST_MODE: MODE
			},
			stdio: 'inherit'
		});
		child.on('exit', (code) => resolve(code));
	});
}

async function run() {
	const activation = { extensionId: EXTENSION_ID, mode: MODE, error: null, activatedAt: null };
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	if (!extension) {
		activation.error = `extension ${EXTENSION_ID} was not discovered`;
	} else {
		try {
			await extension.activate();
			activation.activatedAt = new Date().toISOString();
		} catch (error) {
			activation.error = error instanceof Error ? error.stack ?? error.message : String(error);
		}
	}

	const { server, port } = await startBridge();
	let driverExit = null;
	try {
		driverExit = await runDriver(port);
	} finally {
		server.close();
	}

	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(
		path.join(OUT, 'host-activation.json'),
		`${JSON.stringify({ ...activation, driverExit, workspace: WORKSPACE, cdpPort: CDP_PORT }, null, 2)}\n`
	);
	if (activation.error !== null && MODE !== 'missing-engine') {
		throw new Error(`extension activation failed: ${activation.error}`);
	}
}

module.exports = { run };
