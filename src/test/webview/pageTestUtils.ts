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
import { renderSearchBarHtml } from '../../webview/components/searchBar/searchBar';
import type { EditorProviderToWebview } from '../../webviewProtocol';
import type { DiffProviderToWebview } from '../../diffProtocol';
import { findRanges } from '../../webview/render/searchPattern';
import type { FindOptions } from '../../core/searchModel';

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

function isTreeElement(element: any): boolean {
	return element.id === 'tree';
}

function hasScrollClass(element: any): boolean {
	return (
		element.classList?.contains('document-tree-scroll') ||
		element.classList?.contains('virtual-scroll-vscroll')
	);
}

function isViewportElement(element: any): boolean {
	return isTreeElement(element) || hasScrollClass(element);
}

function elementHeight(element: any): number {
	if (isViewportElement(element)) {
		return VIEW_PORT_HEIGHT;
	}
	return Number(element.dataset?.testClientHeight ?? 0);
}

function elementWidth(element: any): number {
	if (isViewportElement(element)) {
		return VIEW_PORT_WIDTH;
	}
	return Number(element.dataset?.testClientWidth ?? 0);
}

function boundingHeight(element: any): number {
	return element.clientHeight || Number(element.dataset?.testRectHeight ?? 20);
}

function boundingWidth(element: any): number {
	return element.clientWidth || Number(element.dataset?.testRectWidth ?? 100);
}

/** Install jsdom globals and the VS Code API stub for one page. */
export function installDom(kind: 'editor' | 'diff'): InstalledDom {
	// The Monaco shells use Monaco's own find widget. The legacy DOM pages that
	// these tests still mount need their custom widget markup, injected here so
	// production markup stays free of it.
	const search =
		kind === 'diff'
			? renderSearchBarHtml('diff-', 'Find in the diff', false)
			: renderSearchBarHtml('', 'Find in the ECUC tree', true);
	const html = shell(kind).replace('</body>', `${search}</body>`);
	return installMarkup(html);
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
			return elementHeight(this);
		},
	});
	Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
		configurable: true,
		get(this: any) {
			return elementWidth(this);
		},
	});
	window.HTMLElement.prototype.getBoundingClientRect = function (this: any) {
		const height = boundingHeight(this);
		const width = boundingWidth(this);
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

	/** Row store captured from host messages, so a page find gets a host answer. */
	let echoedRows: any[] = [];

	function rowTexts(row: any): string[] {
		if (row.key !== undefined) {
			return [row.left, row.right]
				.filter(Boolean)
				.flatMap((cell: any) => [cell.label, cell.shownValue, ...(cell.meta ?? []).map((part: any) => part.text)]);
		}
		return [row.label, row.shownValue, ...(row.meta ?? []).map((part: any) => part.text)];
	}

	function rowHasHit(row: any, query: string, options: FindOptions): boolean {
		return rowTexts(row).some(
			(text: string | undefined) => text !== undefined && findRanges(text, query, options).length > 0
		);
	}

	function findMatches(query: string, options: FindOptions, changesOnly: boolean): any[] {
		const rows = changesOnly ? echoedRows.filter((row) => row.status !== 'unchanged') : echoedRows;
		return rowsFlat(rows, query, options);
	}

	function rowsFlat(rows: any[], query: string, options: FindOptions): any[] {
		const matches: any[] = [];
		for (const row of rows) {
			if (!rowHasHit(row, query, options)) {
				continue;
			}
			matches.push(
				row.key !== undefined
					? { key: row.key, side: 'left', field: 'value', start: 0, end: 1 }
					: { rowId: row.id, field: 'value', start: 0, end: 1, replaceable: true }
			);
		}
		return matches;
	}

	function dispatchPageMessage(message: any): void {
		window.dispatchEvent(new window.MessageEvent('message', { data: message }));
	}

	const sendFindResult = (message: { requestId?: number; query?: string; options?: FindOptions; changesOnly?: boolean }): void => {
		if (typeof message.requestId !== 'number') {
			return;
		}
		const options = message.options ?? { caseSensitive: false, wholeWord: false, regex: false };
		const matches = findMatches(message.query ?? '', options, message.changesOnly === true);
		dispatchPageMessage({
			type: 'findResult',
			requestId: message.requestId,
			result: { matches, total: matches.length, limited: false }
		});
	};

	function answerReplace(message: any): void {
		if (message?.type !== 'replace' || typeof message.requestId !== 'number') {
			return;
		}
		dispatchPageMessage({
			type: 'replaceResult',
			requestId: message.requestId,
			result: {
				ok: false,
				plans: [],
				reason: 'the test host does not replace',
				replacedFields: 0,
				replacedOccurrences: 0,
				stopped: false
			}
		});
	}

	const protocolPost = api.api.postMessage.bind(api.api);
	api.api.postMessage = (message: any) => {
		protocolPost(message);
		if (message?.type === 'find') {
			sendFindResult(message);
		} else {
			answerReplace(message);
		}
	};

	function captureHostMessage(message: any): void {
		const type = message?.type;
		if (type === 'document') {
			captureRows(message.document);
			return;
		}
		if (type === 'documentPatch') {
			applyEchoedPatch(message.patch);
		}
	}

	function captureRows(documentPayload: any): void {
		if (Array.isArray(documentPayload?.rows)) {
			echoedRows = documentPayload.rows;
		}
	}

	function applyEchoedPatch(patch: any): void {
		echoedRows = [
			...echoedRows.slice(0, patch.at),
			...patch.rows,
			...echoedRows.slice(patch.at + patch.remove)
		];
	}

	return {
		dom,
		window,
		document: window.document,
		api,
		post(message) {
			captureHostMessage(message);
			dispatchPageMessage(message);
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
