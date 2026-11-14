/**
 * The merge command: pick base, ours and theirs, plan the merge, and open the diff
 * panel in merge mode.
 *
 * The panel owns no merge state; this module builds the plan once, exposes the small
 * `MergeController` the panel drives, and writes the result only when asked. No
 * source file is opened for writing and none is modified.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';

import { isEcucValues } from '../../core/ecuc/detect';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { composeMerge } from '../../core/merge/compose';
import { planMerge } from '../../core/merge/plan';
import type { MergeDoc, MergeInput, MergePlan } from '../../core/merge/model';
import { applyResolution } from '../../core/merge/plan';
import type { MergeViewState } from '../../diffProtocol';
import type { CoreEngine } from '../engine/coreEngine';
import { DiffPanel } from '../diffPanel';
import type { MergeController, MergeWriteResult } from './mergeController';

const ROW_OPTIONS = { sort: 'all' as const, sortExcept: SORT_EXCEPTIONS };

async function pickFile(title: string): Promise<vscode.Uri | undefined> {
	const picked = await vscode.window.showOpenDialog({
		canSelectMany: false,
		openLabel: title,
		filters: { ARXML: ['arxml'] },
		title
	});
	return picked?.[0];
}

/** Reads one ECUC document and its engine index; refuses a non-ECUC file. */
async function readMergeDoc(engine: CoreEngine, uri: vscode.Uri): Promise<MergeDoc | undefined> {
	const document = await vscode.workspace.openTextDocument(uri);
	const text = document.getText();
	if (!isEcucValues(text, uri.fsPath)) {
		void vscode.window.showWarningMessage(`"${path.basename(uri.fsPath)}" contains no ECUC values.`);
		return undefined;
	}
	const docId = await engine.openDocument(uri.toString(), text, ROW_OPTIONS);
	try {
		const [rows, nodes] = await Promise.all([engine.rows(docId, ROW_OPTIONS), engine.mergeIndex(docId)]);
		return { uri: uri.toString(), text, rows, nodes };
	} finally {
		await engine.closeDocument(docId);
	}
}

/** `<ours>.merged.arxml`, beside ours and never over a source file. */
function mergedUri(ours: vscode.Uri): vscode.Uri {
	const base = ours.fsPath.replace(/\.arxml$/i, '');
	return vscode.Uri.file(`${base}.merged.arxml`);
}

function conflictViews(plan: MergePlan): MergeViewState['conflicts'] {
	return plan.conflicts.map((conflict) => ({
		nodeId: conflict.id,
		path: conflict.path,
		reason: conflict.reason,
		resolution: conflict.resolution,
		base: conflict.base?.value,
		ours: conflict.ours?.value,
		theirs: conflict.theirs?.value
	}));
}

/** The controller the diff panel drives; the plan is the only mutable state. */
function controllerFor(
	input: MergeInput,
	plan: MergePlan,
	target: vscode.Uri
): MergeController {
	const state = (): MergeViewState => ({
		conflicts: conflictViews(plan),
		unresolved: plan.unresolved,
		target: path.basename(target.fsPath),
		problems: plan.problems
	});
	return {
		state,
		resolve: (nodeId, side) => {
			plan.unresolved = applyResolution(plan, nodeId, side);
			return state();
		},
		write: async (): Promise<MergeWriteResult> => {
			const composed = composeMerge(input, plan);
			if (!composed.ok) {
				return { ok: false, message: composed.reason };
			}
			await vscode.workspace.fs.writeFile(target, Buffer.from(composed.text, 'utf8'));
			await vscode.window.showTextDocument(target, { preview: false });
			return { ok: true, message: `Merged configuration written to ${path.basename(target.fsPath)}` };
		}
	};
}

/** Picks the three files, plans, and opens the panel in merge mode. */
export async function mergeConfigurations(
	context: vscode.ExtensionContext,
	engine: CoreEngine
): Promise<void> {
	const baseUri = await pickFile('Select the base (common ancestor)');
	if (baseUri === undefined) {
		return;
	}
	const oursUri = await pickFile('Select ours (the file to merge into)');
	if (oursUri === undefined) {
		return;
	}
	const theirsUri = await pickFile('Select theirs (the incoming changes)');
	if (theirsUri === undefined) {
		return;
	}
	const [base, ours, theirs] = await Promise.all([
		readMergeDoc(engine, baseUri),
		readMergeDoc(engine, oursUri),
		readMergeDoc(engine, theirsUri)
	]);
	if (base === undefined || ours === undefined || theirs === undefined) {
		return;
	}
	const input: MergeInput = { base, ours, theirs };
	const plan = planMerge(input);
	const target = mergedUri(oursUri);
	const controller = controllerFor(input, plan, target);

	// A panel whose page never boots leaves the merge unreachable; the panel's own
	// watchdog reports that. Nothing else is written here.
	await DiffPanel.open(context, oursUri, theirsUri, controller);
}
