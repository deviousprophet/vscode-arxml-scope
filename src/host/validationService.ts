/**
 * Publishes ECUC validation diagnostics to the Problems panel and the text
 * editor. The rule engine is pure; this module owns only VS Code effects.
 */
import * as vscode from 'vscode';
import type { IndexSubscription } from '../core/index/workspaceIndex';
import { positionAt } from '../core/validation/position';
import { DEFAULT_SEVERITIES, normalizeSeverities } from '../core/validation/types';
import type { CrossFileMode, DiagnosticRelated, EcucDiagnostic, SeveritySettings } from '../core/validation/types';
import { validateWorkspaceSlices } from '../core/validation/validate';
import { crossFileRulesSetting, IndexService } from './indexService';

const DEBOUNCE_MS = 400;

function validationEnabled(): boolean {
	return vscode.workspace.getConfiguration('arxmlScope.validation').get<boolean>('enabled', true);
}

function validationSeverities(): SeveritySettings {
	const raw = vscode.workspace.getConfiguration('arxmlScope.validation').get<unknown>('severities', DEFAULT_SEVERITIES);
	return normalizeSeverities(raw);
}

function validationCaps(): { perFile: number; total: number } {
	const config = vscode.workspace.getConfiguration('arxmlScope.validation');
	const perFile = config.get<number>('maxDiagnosticsPerFile', 500);
	const total = config.get<number>('maxDiagnostics', 5000);
	return {
		perFile: nonNegativeCount(perFile, 500),
		total: nonNegativeCount(total, 5000),
	};
}

/** A finite, non-negative integer, or the fallback for a missing/negative setting. */
function nonNegativeCount(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value < 0) {
		return fallback;
	}
	return Math.floor(value);
}

/** The cross-file rule mode; `auto` needs at least one indexed definition. */
function crossFileRules(): CrossFileMode {
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

/** One publication pass: per-file diagnostics plus the capped-away counts. */
interface DiagnosticBatch {
	byFile: Map<string, vscode.Diagnostic[]>;
	hidden: Map<string, number>;
	total: number;
}

function createBatch(): DiagnosticBatch {
	return { byFile: new Map(), hidden: new Map(), total: 0 };
}

/** True once the per-file or the total cap would drop this diagnostic. */
function isCappedOut(
	batch: DiagnosticBatch,
	file: string,
	caps: { perFile: number; total: number }
): boolean {
	return isFileCapped(batch, file, caps.perFile) || isTotalCapped(batch, caps.total);
}

function isFileCapped(batch: DiagnosticBatch, file: string, perFile: number): boolean {
	if (perFile === 0) {
		return false;
	}
	return fileDiagnosticCount(batch, file) >= perFile;
}

function fileDiagnosticCount(batch: DiagnosticBatch, file: string): number {
	return (batch.byFile.get(file)?.length ?? 0) + (batch.hidden.get(file) ?? 0);
}

function isTotalCapped(batch: DiagnosticBatch, total: number): boolean {
	return total > 0 && batch.total >= total;
}

/** Appends one diagnostic, creating the per-file list on first use. */
function pushDiagnostic(byFile: Map<string, vscode.Diagnostic[]>, file: string, item: vscode.Diagnostic): void {
	const list = byFile.get(file);
	if (list === undefined) {
		byFile.set(file, [item]);
	} else {
		list.push(item);
	}
}

/** `N additional problem(s) …` wording for the hidden-count summary. */
function hiddenSummaryText(count: number): string {
	return `${count} additional problem${count === 1 ? '' : 's'} in this file were hidden by the diagnostic limit.`;
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
		this.subscription = index.subscribe(() => {
			// Cancel an in-flight pass immediately; the debounced run starts the next one.
			this.runToken++;
			this.status.hide();
			this.schedule();
		});
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
			const diagnostics = await this.collectDiagnostics(token);
			if (diagnostics !== undefined) {
				this.publish(diagnostics);
			}
		} finally {
			if (token === this.runToken) {
				this.status.hide();
			}
		}
	}

	/** Pulls one slice per macrotask so the extension host stays responsive. */
	private async collectDiagnostics(token: number): Promise<EcucDiagnostic[] | undefined> {
		const iterator = validateWorkspaceSlices(this.index.workspaceIndex, validationSeverities(), crossFileRules());
		while (true) {
			const step = iterator.next();
			if (step.done) {
				return this.finishedDiagnostics(token, step.value);
			}
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (token !== this.runToken) {
				return undefined;
			}
		}
	}

	/** The last slice is only published when no later run superseded this one. */
	private finishedDiagnostics(token: number, diagnostics: EcucDiagnostic[]): EcucDiagnostic[] | undefined {
		return token === this.runToken ? diagnostics : undefined;
	}

	private publish(diagnostics: EcucDiagnostic[]): void {
		const batch = createBatch();
		const caps = validationCaps();
		for (const diagnostic of diagnostics) {
			this.addDiagnostic(batch, diagnostic, caps);
		}
		this.addHiddenSummaries(batch);
		this.collection.clear();
		for (const [uri, list] of batch.byFile) {
			this.collection.set(vscode.Uri.parse(uri), list);
		}
	}

	private addDiagnostic(batch: DiagnosticBatch, diagnostic: EcucDiagnostic, caps: { perFile: number; total: number }): void {
		if (isCappedOut(batch, diagnostic.file, caps)) {
			batch.hidden.set(diagnostic.file, (batch.hidden.get(diagnostic.file) ?? 0) + 1);
			return;
		}
		pushDiagnostic(batch.byFile, diagnostic.file, this.diagnosticItem(diagnostic));
		batch.total++;
	}

	private diagnosticItem(diagnostic: EcucDiagnostic): vscode.Diagnostic {
		const item = new vscode.Diagnostic(
			this.diagnosticRange(diagnostic),
			diagnostic.message,
			toSeverity(diagnostic.severity)
		);
		item.code = diagnostic.rule;
		item.source = 'ARXML Scope';
		if (diagnostic.related !== undefined && diagnostic.related.length > 0) {
			item.relatedInformation = diagnostic.related.map((related) => this.relatedInformation(related));
		}
		return item;
	}

	private diagnosticRange(diagnostic: EcucDiagnostic): vscode.Range {
		const file = this.index.workspaceIndex.file(diagnostic.file);
		const start = positionAt(file?.lineStarts, diagnostic.range.start);
		const end = positionAt(file?.lineStarts, diagnostic.range.end);
		return new vscode.Range(start.line, start.character, end.line, end.character);
	}

	private relatedInformation(related: DiagnosticRelated): vscode.DiagnosticRelatedInformation {
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
	}

	/** One informational summary per file that lost diagnostics to a cap. */
	private addHiddenSummaries(batch: DiagnosticBatch): void {
		for (const [file, count] of batch.hidden) {
			const summary = this.hiddenSummary(file, count);
			pushDiagnostic(batch.byFile, file, summary);
		}
	}

	private hiddenSummary(file: string, count: number): vscode.Diagnostic {
		const entry = this.index.workspaceIndex.file(file);
		const point = positionAt(entry?.lineStarts, 0);
		const summary = new vscode.Diagnostic(
			new vscode.Range(point.line, point.character, point.line, point.character),
			hiddenSummaryText(count),
			vscode.DiagnosticSeverity.Information
		);
		summary.code = 'diagnosticCap';
		summary.source = 'ARXML Scope';
		return summary;
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
