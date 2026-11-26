/**
 * Phase 3 host launcher for the UX review.
 *
 * Starts a real VS Code (Extension Development Host) with the extension under
 * review, a throwaway workspace copied from the diff fixtures and a CDP port.
 * The in-host suite (`suite.cjs`) then starts the bridge and runs the
 * Playwright driver (`driver.mjs`).
 *
 * Run from the repository root:
 *   node .agents/skills/ux-review/scripts/host/run.mjs
 *
 * Env:
 *   UX_HOST_MODE=missing-engine   hide the staged engine binary for FIRST-02
 *   UX_HOST_ONLY=gate,edit,...    comma list passed to the driver
 *   HOST_OUT=<dir>                artifact directory (default: skill artifacts/host)
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const outDir = process.env.HOST_OUT
	? path.resolve(process.env.HOST_OUT)
	: path.resolve(here, '../artifacts/host', process.env.UX_HOST_MODE === 'missing-engine' ? 'missing-engine' : '.');
const mode = process.env.UX_HOST_MODE ?? 'normal';
const only = process.env.UX_HOST_ONLY ?? '';

const workspace = mkdtempSync(path.join(tmpdir(), 'arxml-ux-host-ws-'));
const userData = mkdtempSync(path.join(tmpdir(), 'arxml-ux-host-profile-'));
const engineName = process.platform === 'win32' ? 'arxml-engine.exe' : 'arxml-engine';
const engineExe = path.join(repoRoot, 'dist', 'engine', `${process.platform}-${process.arch}`, engineName);
const engineBackup = `${engineExe}.ux-hidden`;
let hiddenEngine = false;

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
	});
}

function seedWorkspace() {
	const fixtures = path.join(repoRoot, 'src', 'test', 'fixtures', 'diff');
	for (const name of ['left.arxml', 'right.arxml']) {
		cpSync(path.join(fixtures, name), path.join(workspace, name));
	}
	writeFileSync(path.join(workspace, 'empty.arxml'), '');
	writeFileSync(
		path.join(workspace, 'not-ecuc.arxml'),
		'<?xml version="1.0" encoding="UTF-8"?>\n<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES/></AUTOSAR>\n'
	);
	writeFileSync(
		path.join(workspace, 'malformed.arxml'),
		'<?xml version="1.0" encoding="UTF-8"?>\n<AUTOSAR><AR-PACKAGES><AR-PACKAGE></AUTOSAR>\n'
	);
	writeFileSync(path.join(workspace, '.vscode-settings.json'), '{}\n');
}

const executable =
	process.env.VSCODE_EXE ??
	path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe');

mkdirSync(outDir, { recursive: true });
seedWorkspace();

if (mode === 'missing-engine') {
	if (!existsSync(engineExe)) {
		console.error(JSON.stringify({ _type: 'host-run', ok: false, error: `engine binary missing at ${engineExe}` }));
		process.exit(1);
	}
	renameSync(engineExe, engineBackup);
	hiddenEngine = true;
}

const startedAt = new Date().toISOString();
let result = { ok: false };
try {
	const cdpPort = await freePort();
	await runTests({
		vscodeExecutablePath: executable,
		extensionDevelopmentPath: repoRoot,
		extensionTestsPath: path.join(here, 'suite.cjs'),
		launchArgs: [
			workspace,
			'--disable-workspace-trust',
			'--disable-extensions',
			'--skip-welcome',
			'--skip-release-notes',
			`--remote-debugging-port=${cdpPort}`,
			`--user-data-dir=${userData}`
		],
		extensionTestsEnv: {
			HOST_OUT: outDir,
			HOST_WORKSPACE: workspace,
			HOST_CDP_PORT: String(cdpPort),
			HOST_MODE: mode,
			HOST_ONLY: only,
			HOST_REPO_ROOT: repoRoot
		}
	});
	result = { ok: true, mode, workspace, cdpPort };
} catch (error) {
	result = {
		ok: false,
		mode,
		error: error instanceof Error ? error.stack ?? error.message : String(error)
	};
	console.error(`host run failed: ${result.error}`);
} finally {
	if (hiddenEngine) {
		try {
			renameSync(engineBackup, engineExe);
		} catch (error) {
			console.error(`could not restore engine binary: ${String(error)}`);
		}
	}
	rmSync(workspace, { recursive: true, force: true });
	rmSync(userData, { recursive: true, force: true });
	const summary = { _type: 'host-run', startedAt, finishedAt: new Date().toISOString(), ...result, outDir };
	writeFileSync(path.join(outDir, 'host-run.json'), `${JSON.stringify(summary, null, 2)}\n`);
	console.log(JSON.stringify({ _type: 'host-run', ok: summary.ok, outDir, mode }));
	if (!summary.ok) {
		process.exitCode = 1;
	}
}
