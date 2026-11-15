/**
 * Engine status bar, output channel and the `Show Engine Status` command.
 *
 * The supervisor owns the process; this module only renders its health and offers a
 * restart. No engine request is needed to open the status.
 */
import * as vscode from 'vscode';

import type { CoreEngine } from './engine/coreEngine';
import { formatEngineHealth, type EngineHealth, type EngineProcessState } from './engine/engineHealth';

const ENGINE_STATUS_COMMAND = 'vscode-arxml-scope.showEngineStatus';
const REFRESH_MS = 30_000;

const STATUS_TEXT: Record<EngineProcessState, string> = {
	running: '$(pulse) ARXML Engine',
	starting: '$(sync~spin) ARXML Engine',
	restarting: '$(sync~spin) ARXML Engine',
	failed: '$(error) ARXML Engine',
	disposed: '$(circle-slash) ARXML Engine'
};

function statusText(state: EngineProcessState): string {
	return STATUS_TEXT[state];
}

function healthLine(health: EngineHealth): string {
	const pid = health.pid === undefined ? '' : `, pid ${health.pid}`;
	return `ARXML Scope engine ${health.state}${pid}`;
}

function writeHealth(output: vscode.OutputChannel, health: EngineHealth): void {
	output.clear();
	output.appendLine('ARXML Scope engine status');
	output.appendLine('');
	output.appendLine(formatEngineHealth(health));
	output.show(true);
}

async function restartEngine(engine: CoreEngine): Promise<void> {
	if (engine.restart === undefined) {
		return;
	}
	try {
		await engine.restart();
		void vscode.window.showInformationMessage('ARXML Scope: engine restarted');
	} catch (error) {
		void vscode.window.showErrorMessage(
			`ARXML Scope: engine restart failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function showStatus(
	engine: CoreEngine,
	output: vscode.OutputChannel,
	refresh: () => Promise<void>
): Promise<void> {
	if (engine.health === undefined) {
		void vscode.window.showWarningMessage('ARXML Scope: this engine does not report health');
		return;
	}
	const health = await engine.health();
	writeHealth(output, health);
	const action = await vscode.window.showInformationMessage(
		healthLine(health),
		'Restart Engine',
		'Open Output'
	);
	if (action === 'Open Output') {
		output.show(true);
		return;
	}
	if (action === 'Restart Engine') {
		await restartEngine(engine);
	}
	await refresh();
}

/** Registers the status item, output channel and command. */
export function registerEngineStatus(context: vscode.ExtensionContext, engine: CoreEngine): void {
	const output = vscode.window.createOutputChannel('ARXML Scope Engine');
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
	item.command = ENGINE_STATUS_COMMAND;
	context.subscriptions.push(output, item);

	const refresh = async (): Promise<void> => {
		if (engine.health === undefined) {
			item.hide();
			return;
		}
		const health = await engine.health();
		item.text = statusText(health.state);
		item.tooltip = health.lastError === undefined ? healthLine(health) : `${healthLine(health)}\n${health.lastError}`;
		if (health.state === 'disposed') {
			item.hide();
			return;
		}
		item.show();
	};

	const timer = setInterval(() => {
		void refresh();
	}, REFRESH_MS);
	context.subscriptions.push({ dispose: () => clearInterval(timer) });

	if (engine.onDidChangeState !== undefined) {
		context.subscriptions.push(engine.onDidChangeState(() => void refresh()));
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(ENGINE_STATUS_COMMAND, () => showStatus(engine, output, refresh))
	);

	void refresh();
}
