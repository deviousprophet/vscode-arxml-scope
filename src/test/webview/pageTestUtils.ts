/**
 * A real DOM for the bundled webview pages.
 *
 * The compiled extension-host tests run in Node, so the page is mounted into
 * jsdom with the same static shell the host writes. The bundled entrypoint is
 * loaded after the globals exist; `acquireVsCodeApi` is a message recorder so a
 * test can drive the host → page protocol and inspect what the page posts back.
 */
import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import './cssImportHook';

import { editorShell, diffShell } from '../../host/webviewShell';
import type { EditorProviderToWebview } from '../../webviewProtocol';
import type { DiffProviderToWebview } from '../../diffProtocol';

export interface HostMessageRecorder {
	messages: any[];
	state: unknown;
	api: { postMessage(message: any): void; getState(): unknown; setState(state: unknown): void };
}

export interface InstalledDom {
	dom: JSDOM;
	window: any;
	document: any;
	api: HostMessageRecorder;
	restore(): void;
	post(message: EditorProviderToWebview | DiffProviderToWebview): void;
}

const VIEW_PORT_HEIGHT = 600;
const VIEW_PORT_WIDTH = 900;

function shell(kind: 'editor' | 'diff'): string {
	const assets = {
		cspSource: 'https://webview.test',
		scriptUri: `https://webview.test/${kind === 'editor' ? 'editorViewer' : 'diffViewer'}.js`,
		styleUri: `https://webview.test/${kind === 'editor' ? 'editorViewer' : 'diffViewer'}.css`,
		nonce: 'test-nonce',
	};
	return kind === 'editor' ? editorShell(assets) : diffShell(assets);
}

/** Install jsdom globals and the VS Code API stub for one page. */
export function installDom(kind: 'editor' | 'diff'): InstalledDom {
	return installMarkup(shell(kind));
}

/** Install jsdom globals for arbitrary page markup. */
export function installMarkup(html: string): InstalledDom {
	const dom = new JSDOM(html, { url: 'https://webview.test/', pretendToBeVisual: true });
	const globals = globalThis as unknown as Record<string, unknown>;
	const saved: Record<string, unknown> = {};
	for (const name of [
		'window',
		'document',
		'Element',
		'HTMLElement',
		'SVGElement',
		'Node',
		'getComputedStyle',
		'requestAnimationFrame',
		'cancelAnimationFrame',
		'ResizeObserver',
		'acquireVsCodeApi',
	]) {
		saved[name] = globals[name];
	}
	const window = dom.window as any;
	globals.window = window;
	globals.document = window.document;
	globals.Element = window.Element;
	globals.HTMLElement = window.HTMLElement;
	globals.SVGElement = window.SVGElement;
	globals.Node = window.Node;
	globals.getComputedStyle = window.getComputedStyle.bind(window);
	globals.requestAnimationFrame = (run: (time: number) => void) => setTimeout(() => run(Date.now()), 0);
	globals.cancelAnimationFrame = (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle);
	globals.ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};

	// jsdom performs no layout. The page needs a viewport height/width to window
	// the virtual row list, so give every element a deterministic box.
	Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
		configurable: true,
		get(this: any) {
			if (this.id === 'tree' || this.classList?.contains('document-tree-scroll')) {
				return VIEW_PORT_HEIGHT;
			}
			return Number(this.dataset?.testClientHeight ?? 0);
		},
	});
	Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
		configurable: true,
		get(this: any) {
			if (this.id === 'tree' || this.classList?.contains('document-tree-scroll')) {
				return VIEW_PORT_WIDTH;
			}
			return Number(this.dataset?.testClientWidth ?? 0);
		},
	});
	window.HTMLElement.prototype.getBoundingClientRect = function (this: any) {
		const height = this.clientHeight || Number(this.dataset?.testRectHeight ?? 20);
		const width = this.clientWidth || Number(this.dataset?.testRectWidth ?? 100);
		return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height };
	};

	const api: HostMessageRecorder = {
		messages: [],
		state: undefined,
		api: {
			postMessage(message: any) {
				api.messages.push(message);
			},
			getState() {
				return api.state;
			},
			setState(state: unknown) {
				api.state = state;
			},
		},
	};
	window.acquireVsCodeApi = () => api.api;
	globals.acquireVsCodeApi = () => api.api;

	return {
		dom,
		window,
		document: window.document,
		api,
		post(message) {
			window.dispatchEvent(new window.MessageEvent('message', { data: message }));
		},
		restore() {
			for (const [name, value] of Object.entries(saved)) {
				if (value === undefined) {
					delete globals[name];
				} else {
					globals[name] = value;
				}
			}
			dom.window.close();
		},
	};
}

/** Load a freshly evaluated copy of an entrypoint module, without its auto-boot. */
export function loadModule<T>(path: string): T {
	const resolved = require.resolve(path);
	delete require.cache[resolved];
	const globals = globalThis as unknown as Record<string, unknown>;
	const savedDocument = globals.document;
	const savedWindow = globals.window;
	globals.document = undefined;
	globals.window = undefined;
	try {
		return require(resolved) as T;
	} finally {
		globals.document = savedDocument;
		globals.window = savedWindow;
	}
}

/** Wait one animation frame so a scheduled render has run. */
export async function nextFrame(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 15));
}

/** Wait past the search debounce and two chunk timers. */
export async function settleSearch(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 220));
}

/** The rows under one Document tree window. */
export function treeRows(document: any, selector = '#tree'): any[] {
	return Array.from(document.querySelectorAll(`${selector} [role="treeitem"]`)) as any[];
}

/** The visible row labels in order. */
export function rowLabels(document: any, selector = '#tree'): string[] {
	return treeRows(document, selector).map((row: any) => row.querySelector('.label')?.textContent ?? '');
}

/** The posted messages of one type. */
export function messagesOf(api: HostMessageRecorder, type: string): any[] {
	return api.messages.filter((message) => message && message.type === type);
}

/** Assert the page announced a live boot. */
export function expectReady(api: HostMessageRecorder): void {
	assert.ok(
		api.messages.some((message) => message && message.type === 'ready'),
		'the page posted its ready message'
	);
}
