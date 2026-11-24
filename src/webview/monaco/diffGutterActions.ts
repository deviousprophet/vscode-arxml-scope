import { Codicon } from 'monaco-editor/base/common/codicons.js';
import { CommandsRegistry } from 'monaco-editor/platform/commands/common/commands.js';
import { MenuId, MenuRegistry } from 'monaco-editor/platform/actions/common/actions.js';
import { ContextKeyExpr } from 'monaco-editor/platform/contextkey/common/contextkey.js';

/** A 1-based Monaco line range; `endLineNumberExclusive` may be 0 for an empty side. */
export interface DiffGutterRange {
	startLineNumber: number;
	endLineNumberExclusive: number;
}

export interface DiffGutterMapping {
	original: DiffGutterRange;
	modified: DiffGutterRange;
}

/** The context `ActionRunnerWithContext` forwards to a hunk-toolbar command. */
export interface DiffGutterContext {
	mapping?: DiffGutterMapping | null;
}

export type DiffGutterDirection = 'left' | 'right';
export type DiffGutterHandler = (
	direction: DiffGutterDirection,
	context: DiffGutterContext | undefined
) => void;

const COPY_LEFT_ID = 'arxml.diff.copyBlockToLeft';
const COPY_RIGHT_ID = 'arxml.diff.copyBlockToRight';

export const COPY_LEFT_CONTEXT = 'arxml.copyLeftAvailable';
export const COPY_RIGHT_CONTEXT = 'arxml.copyRightAvailable';

let handler: DiffGutterHandler | undefined;
let registered = false;

function asContext(value: unknown): DiffGutterContext | undefined {
	return typeof value === 'object' && value !== null ? (value as DiffGutterContext) : undefined;
}

function run(direction: DiffGutterDirection, context: unknown): void {
	handler?.(direction, asContext(context));
}

/**
 * Register the two ARXML copy actions on the built-in diff hunk toolbar.
 * The built-in Revert action is hidden by the diff editor's readOnly context;
 * these actions deliberately do not depend on `diffEditorModifiedWritable`.
 */
export function installDiffGutterActions(next: DiffGutterHandler): void {
	handler = next;
	if (registered) {
		return;
	}
	registered = true;
	CommandsRegistry.registerCommand(COPY_LEFT_ID, (_accessor, context) => run('left', context));
	CommandsRegistry.registerCommand(COPY_RIGHT_ID, (_accessor, context) => run('right', context));
	MenuRegistry.appendMenuItem(MenuId.DiffEditorHunkToolbar, {
		command: { id: COPY_LEFT_ID, title: 'Copy Block to Left', icon: Codicon.arrowLeft },
		when: ContextKeyExpr.has(COPY_LEFT_CONTEXT),
		group: 'primary',
		order: 5
	});
	MenuRegistry.appendMenuItem(MenuId.DiffEditorHunkToolbar, {
		command: { id: COPY_RIGHT_ID, title: 'Copy Block to Right', icon: Codicon.arrowRight },
		when: ContextKeyExpr.has(COPY_RIGHT_CONTEXT),
		group: 'primary',
		order: 5
	});
}
