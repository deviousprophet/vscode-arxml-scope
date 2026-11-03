/**
 * Publishes ECUC validation diagnostics to the Problems panel and the text
 * editor. The rule engine is pure; this module owns only VS Code effects.
 */
import * as vscode from 'vscode';
import type { IndexSubscription } from '../core/index/workspaceIndex';
import { positionAt } from '../core/validation/position';
import { DEFAULT_SEVERITIES, normalizeSeverities } from '../core/validation/types';
import type { SeveritySettings } from '../core/validation/types';
import { validateWorkspace } from '../core/validation/validate';
import { IndexService } from './indexService';

const DEBOUNCE_MS = 400;

export function validationEnabled(): boolean {
	return vscode.workspace.getConfiguration('arxmlScope.validation').get<boolean>('enabled', true);
}

export function validationSeverities(): SeveritySettings {
	const raw = vscode.workspace.getConfiguration('arxmlScope.validation').get<unknown>('severities', DEFAULT_SEVERITIES);
	return normalizeSeverities(raw);
}

function toSeverity(level: string): vscode.DiagnosticSeverity {
	switch (level) {
		case 'error':
			return vscode.DiagnosticSeverity.Error;
		case 'warning':
			return vscode.DiagnosticSeverity.Warning;
		default:
			return vscode.DiagnosticSeverity.Information;
	}
}

export class ValidationService implements vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection('arxmlScope');
	private readonly subscription: IndexSubscription;
	private readonly configuration: vscode.Disposable;
	private timer?: ReturnType<typeof setTimeout>;

	constructor(private readonly index: IndexService) {
		this.subscription = index.subscribe(() => this.schedule());
		this.configuration = vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('arxmlScope.validation')) {
				this.refresh();
			}
		});
		this.refresh();
	}

	/** Recomputes every diagnostic; an empty collection means no current problem. */
	refresh(): void {
		if (!validationEnabled()) {
			this.collection.clear();
			return;
		}
		const diagnostics = validateWorkspace(this.index.workspaceIndex, validationSeverities());
		const byFile = new Map<string, vscode.Diagnostic[]>();
		for (const diagnostic of diagnostics) {
			const file = this.index.workspaceIndex.file(diagnostic.file);
			const start = positionAt(file?.lineStarts, diagnostic.range.start);
			const end = positionAt(file?.lineStarts, diagnostic.range.end);
			const item = new vscode.Diagnostic(
				new vscode.Range(start.line, start.character, end.line, end.character),
				diagnostic.message,
				toSeverity(diagnostic.severity)
			);
			item.code = diagnostic.rule;
			item.source = 'ARXML Scope';
			const list = byFile.get(diagnostic.file);
			if (list === undefined) {
				byFile.set(diagnostic.file, [item]);
			} else {
				list.push(item);
			}
		}
		this.collection.clear();
		for (const [uri, list] of byFile) {
			this.collection.set(vscode.Uri.parse(uri), list);
		}
	}

	dispose(): void {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
		}
		this.subscription.dispose();
		this.configuration.dispose();
		this.collection.dispose();
	}

	private schedule(): void {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.refresh();
		}, DEBOUNCE_MS);
	}
}
