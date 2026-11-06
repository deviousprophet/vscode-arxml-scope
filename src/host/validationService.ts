/**
 * Publishes ECUC validation diagnostics to the Problems panel and the text
 * editor. The rule engine is pure; this module owns only VS Code effects.
 */
import * as vscode from 'vscode';
import type { IndexSubscription } from '../core/index/workspaceIndex';
import { positionAt } from '../core/validation/position';
import { DEFAULT_SEVERITIES, normalizeSeverities } from '../core/validation/types';
import type { CrossFileMode, EcucDiagnostic, SeveritySettings } from '../core/validation/types';
import { validateWorkspaceSlices } from '../core/validation/validate';
import { crossFileRulesSetting, IndexService } from './indexService';

const DEBOUNCE_MS = 400;

export function validationEnabled(): boolean {
	return vscode.workspace.getConfiguration('arxmlScope.validation').get<boolean>('enabled', true);
}

export function validationSeverities(): SeveritySettings {
	const raw = vscode.workspace.getConfiguration('arxmlScope.validation').get<unknown>('severities', DEFAULT_SEVERITIES);
	return normalizeSeverities(raw);
}

export function validationCaps(): { perFile: number; total: number } {
	const config = vscode.workspace.getConfiguration('arxmlScope.validation');
	const perFile = config.get<number>('maxDiagnosticsPerFile', 500);
	const total = config.get<number>('maxDiagnostics', 5000);
	return {
		perFile: Number.isFinite(perFile) && perFile >= 0 ? Math.floor(perFile) : 500,
		total: Number.isFinite(total) && total >= 0 ? Math.floor(total) : 5000,
	};
}

/** The cross-file rule mode; `auto` needs at least one indexed definition. */
export function crossFileRules(): CrossFileMode {
	return crossFileRulesSetting();
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
	private readonly status: vscode.StatusBarItem;
	private readonly subscription: IndexSubscription;
	private readonly configuration: vscode.Disposable;
	private timer?: ReturnType<typeof setTimeout>;
	private runToken = 0;

	constructor(private readonly index: IndexService) {
		this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
		this.status.text = '$(sync~spin) ARXML Scope: validating…';
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
		void this.run();
	}

	private async run(): Promise<void> {
		const token = ++this.runToken;
		if (!validationEnabled()) {
			this.collection.clear();
			this.status.hide();
			return;
		}
		this.status.show();
		try {
			const iterator = validateWorkspaceSlices(this.index.workspaceIndex, validationSeverities(), crossFileRules());
			let diagnostics: EcucDiagnostic[] | undefined;
			while (true) {
				const step = iterator.next();
				if (step.done) {
					diagnostics = step.value;
					break;
				}
				await new Promise<void>((resolve) => setImmediate(resolve));
				if (token !== this.runToken) {
					return;
				}
			}
			if (token !== this.runToken || diagnostics === undefined) {
				return;
			}
			this.publish(diagnostics);
		} finally {
			if (token === this.runToken) {
				this.status.hide();
			}
		}
	}

	private publish(diagnostics: EcucDiagnostic[]): void {
		const caps = validationCaps();
		const byFile = new Map<string, vscode.Diagnostic[]>();
		const hidden = new Map<string, number>();
		let total = 0;
		for (const diagnostic of diagnostics) {
			const file = this.index.workspaceIndex.file(diagnostic.file);
			const actualCount = (byFile.get(diagnostic.file)?.length ?? 0) + (hidden.get(diagnostic.file) ?? 0);
			const overFile = caps.perFile > 0 && actualCount >= caps.perFile;
			const overTotal = caps.total > 0 && total >= caps.total;
			if (overFile || overTotal) {
				hidden.set(diagnostic.file, (hidden.get(diagnostic.file) ?? 0) + 1);
				continue;
			}
			const start = positionAt(file?.lineStarts, diagnostic.range.start);
			const end = positionAt(file?.lineStarts, diagnostic.range.end);
			const item = new vscode.Diagnostic(
				new vscode.Range(start.line, start.character, end.line, end.character),
				diagnostic.message,
				toSeverity(diagnostic.severity)
			);
			item.code = diagnostic.rule;
			item.source = 'ARXML Scope';
			if (diagnostic.related !== undefined && diagnostic.related.length > 0) {
				item.relatedInformation = diagnostic.related.map((related) => {
					const relatedFile = this.index.workspaceIndex.file(related.file);
					const relatedStart = positionAt(relatedFile?.lineStarts, related.range.start);
					const relatedEnd = positionAt(relatedFile?.lineStarts, related.range.end);
					return new vscode.DiagnosticRelatedInformation(
						new vscode.Location(
							vscode.Uri.parse(related.file),
							new vscode.Range(relatedStart.line, relatedStart.character, relatedEnd.line, relatedEnd.character)
						),
						related.message
					);
				});
			}
			const list = byFile.get(diagnostic.file);
			if (list === undefined) {
				byFile.set(diagnostic.file, [item]);
			} else {
				list.push(item);
			}
			total++;
		}
		for (const [file, count] of hidden) {
			const entry = this.index.workspaceIndex.file(file);
			const point = positionAt(entry?.lineStarts, 0);
			const summary = new vscode.Diagnostic(
				new vscode.Range(point.line, point.character, point.line, point.character),
				`${count} additional problem${count === 1 ? '' : 's'} in this file were hidden by the diagnostic limit.`,
				vscode.DiagnosticSeverity.Information
			);
			summary.code = 'diagnosticCap';
			summary.source = 'ARXML Scope';
			const list = byFile.get(file) ?? [];
			list.push(summary);
			byFile.set(file, list);
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
		this.status.dispose();
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
