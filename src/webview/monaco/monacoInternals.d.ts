/// <reference types="monaco-editor" />

/**
 * Minimal declarations for the pinned Monaco internals used by the gutter
 * adapter. The package does not publish type declarations for these modules.
 * The `diffCodeParity` test pins the package version and upstream file hashes.
 */

declare module 'monaco-editor/base/common/codicons.js' {
	export interface ThemeIcon {
		id: string;
	}
	export const Codicon: {
		arrowLeft: ThemeIcon;
		arrowRight: ThemeIcon;
	};
}

declare module 'monaco-editor/platform/actions/common/actions.js' {
	export interface MenuItemCommand {
		id: string;
		title: string;
		icon?: unknown;
	}
	export interface MenuItem {
		command: MenuItemCommand;
		when?: unknown;
		group?: string;
		order?: number;
	}
	export const MenuId: {
		DiffEditorHunkToolbar: unknown;
	};
	export const MenuRegistry: {
		appendMenuItem(id: unknown, item: MenuItem): unknown;
	};
}

declare module 'monaco-editor/platform/commands/common/commands.js' {
	export const CommandsRegistry: {
		registerCommand(
			id: string,
			handler: (accessor: unknown, context?: unknown) => unknown
		): unknown;
	};
}

declare module 'monaco-editor/platform/contextkey/common/contextkey.js' {
	export interface IContextKey<T> {
		set(value: T, tx?: unknown): void;
	}
	export interface IContextKeyService {
		createKey<T>(key: string, defaultValue: T): IContextKey<T>;
	}
	export const ContextKeyExpr: {
		has(key: string): unknown;
	};
	export const IContextKeyService: unknown;
}

declare module 'monaco-editor/editor/standalone/browser/standaloneServices.js' {
	export const StandaloneServices: {
		get<T>(id: unknown): T;
	};
}
