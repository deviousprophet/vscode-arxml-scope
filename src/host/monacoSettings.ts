/**
 * The curated VS Code editor settings both Monaco pages inherit.
 *
 * One host-side mapping, so the editor and the diff always read the same
 * `editor.*` values and preview the same density without a second config source.
 */
import * as vscode from 'vscode';

import type { MonacoSettings } from '../webviewProtocol';

/** The curated `editor.*` values the Monaco surfaces inherit. */
export function monacoSettings(): MonacoSettings {
	const config = vscode.workspace.getConfiguration('editor');
	return {
		fontFamily: config.get<string>('fontFamily'),
		fontSize: config.get<number>('fontSize'),
		lineHeight: config.get<number>('lineHeight'),
		fontWeight: config.get<string>('fontWeight'),
		wordWrap: config.get<'on' | 'off' | 'wordWrapColumn' | 'bounded'>('wordWrap', 'off'),
		wordWrapColumn: config.get<number>('wordWrapColumn'),
		minimap: config.get<boolean>('minimap.enabled', true),
		stickyScroll: config.get<boolean>('stickyScroll.enabled', true),
		indentationGuides: config.get<boolean>('guides.indentation', true),
		bracketPairGuides: config.get<boolean | 'active'>('guides.bracketPairs', false),
		cursorStyle: config.get<MonacoSettings['cursorStyle']>('cursorStyle'),
		cursorBlinking: config.get<MonacoSettings['cursorBlinking']>('cursorBlinking', 'blink'),
		smoothScrolling: config.get<boolean>('smoothScrolling', true),
		renderWhitespace: config.get<MonacoSettings['renderWhitespace']>('renderWhitespace', 'selection'),
	};
}
