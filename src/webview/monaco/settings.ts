/**
 * The curated `editor.*` settings mapped onto Monaco editor options.
 *
 * The editor and the diff both consume the same `MonacoSettings` payload; this
 * module is the single mapping, so a new setting lands on both surfaces at once
 * instead of drifting into a second, page-local option set.
 */
import type * as monaco from 'monaco-editor';

import type { MonacoSettings } from '../../webviewProtocol';

export type EditorOptionsUpdate = Parameters<monaco.editor.IStandaloneCodeEditor['updateOptions']>[0];

export function settingsOptions(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...fontSettings(settings),
		...wrapSettings(settings),
		...guideSettings(settings),
		...cursorSettings(settings),
		...renderSettings(settings)
	};
}

function fontSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...fontFamilySetting(settings),
		...fontSizeSetting(settings),
		...lineHeightSetting(settings),
		...fontWeightSetting(settings)
	};
}

function fontFamilySetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.fontFamily !== undefined ? { fontFamily: settings.fontFamily } : {};
}

function fontSizeSetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.fontSize !== undefined ? { fontSize: settings.fontSize } : {};
}

function lineHeightSetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.lineHeight !== undefined && settings.lineHeight > 0 ? { lineHeight: settings.lineHeight } : {};
}

function fontWeightSetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.fontWeight !== undefined ? { fontWeight: settings.fontWeight } : {};
}

function wrapSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...(settings.wordWrap !== undefined ? { wordWrap: settings.wordWrap } : {}),
		...(settings.wordWrapColumn !== undefined ? { wordWrapColumn: settings.wordWrapColumn } : {})
	};
}

function guideSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...(settings.minimap !== undefined ? { minimap: { enabled: settings.minimap } } : {}),
		...stickyScrollSetting(settings),
		...indentationGuideSetting(settings)
	};
}

function stickyScrollSetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.stickyScroll !== undefined
		? { stickyScroll: { enabled: settings.stickyScroll, defaultModel: 'foldingProviderModel' } }
		: {};
}

function indentationGuideSetting(settings: MonacoSettings): EditorOptionsUpdate {
	if (!hasGuideSetting(settings)) {
		return {};
	}
	return {
		guides: {
			indentation: indentationGuides(settings),
			bracketPairs: bracketPairGuides(settings)
		}
	};
}

function hasGuideSetting(settings: MonacoSettings): boolean {
	return settings.indentationGuides !== undefined || settings.bracketPairGuides !== undefined;
}

function indentationGuides(settings: MonacoSettings): boolean {
	return settings.indentationGuides ?? true;
}

function bracketPairGuides(settings: MonacoSettings): boolean | 'active' {
	return settings.bracketPairGuides ?? false;
}

function cursorSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...(settings.cursorStyle !== undefined ? { cursorStyle: settings.cursorStyle } : {}),
		...(settings.cursorBlinking !== undefined ? { cursorBlinking: settings.cursorBlinking } : {}),
		...(settings.smoothScrolling !== undefined ? { smoothScrolling: settings.smoothScrolling } : {})
	};
}

function renderSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.renderWhitespace !== undefined ? { renderWhitespace: settings.renderWhitespace } : {};
}
