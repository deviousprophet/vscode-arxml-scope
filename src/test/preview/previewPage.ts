/**
 * Browser entry for the preview pages.
 *
 * Mounts the real page, then posts the host messages the state describes. The
 * production shell is server-rendered; this file only drives the protocol, a
 * few DOM gestures (Swap, horizontal pan, F7, a changed-row click), then records
 * a rendered-geometry audit for the screenshot runner. No page code is forked.
 */
// The production entries auto-mount when their page root is present, exactly as
// the extension webview does. Importing them is the whole wiring; calling the
// mount functions again would bind every toolbar action twice.
import '../../webview/diffViewer';
import '../../webview/editorViewer';
import { paneSnapshot, previewAudit } from './previewAudit';
import type { PaneSnapshot } from './previewAudit';

interface PreviewPayload {
	state: string;
	page: 'diff' | 'editor';
	message: unknown;
	merge?: boolean;
	swap?: boolean;
	wide?: boolean;
	pan?: number;
	jump?: number;
	select?: boolean;
}

declare global {
	interface Window {
		__PREVIEW__: PreviewPayload;
		__PREVIEW_MESSAGES__: unknown[];
	}
}

const payload = window.__PREVIEW__;
let swapBefore: PaneSnapshot | undefined;

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A short timer lets the resize observer and the final layout settle. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 50));
}

function click(id: string): void {
	const element = document.getElementById(id);
	if (element) {
		element.click();
	}
}

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 80; attempt++) {
		if (predicate()) {
			return;
		}
		await tick();
	}
}

async function jumpToChange(): Promise<void> {
	const pane = document.getElementById('diff-pane-left');
	if (!pane) {
		return;
	}
	pane.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true })
	);
	await tick();
}

async function applyMerge(): Promise<void> {
	if (payload.merge === undefined) {
		return;
	}
	window.postMessage({ type: 'mergeMode', enabled: payload.merge }, '*');
	await tick();
}

async function applySwap(): Promise<void> {
	if (!payload.swap) {
		return;
	}
	swapBefore = paneSnapshot();
	click('diff-swap');
	await tick();
}

async function applyPan(): Promise<void> {
	if (!payload.pan) {
		return;
	}
	const bar = document.querySelector('#diff-list .virtual-scroll-hscroll-left') as HTMLElement | null;
	if (!bar) {
		return;
	}
	bar.scrollLeft = payload.pan;
	bar.dispatchEvent(new Event('scroll', { bubbles: true }));
	await tick();
}

async function applyJumps(): Promise<void> {
	for (let press = 0; press < (payload.jump ?? 0); press++) {
		await jumpToChange();
	}
}

function selectRow(): HTMLElement | null {
	if (payload.page === 'editor') {
		return document.querySelector(
			'#tree-pane .node[data-document-index]:not([aria-selected="true"])'
		) as HTMLElement | null;
	}
	return document.querySelector('#diff-pane-left .diff-row[data-status="changed"]') as HTMLElement | null;
}

async function applySelect(): Promise<void> {
	if (!payload.select) {
		return;
	}
	const row = selectRow();
	row?.click();
	await tick();
}

function publishAudit(): void {
	const audit = previewAudit(
		{
			name: payload.state,
			page: payload.page,
			merge: payload.merge,
			swap: payload.swap,
			wide: payload.wide,
			pan: payload.pan,
			select: payload.select
		},
		swapBefore
	);
	const node = document.createElement('script');
	node.type = 'application/json';
	node.id = 'preview-audit';
	node.textContent = JSON.stringify(audit).replaceAll('<', '\\u003c');
	document.body.appendChild(node);
}

async function run(): Promise<void> {
	window.postMessage(payload.message, '*');
	await until(() => document.querySelector('#diff-pane-left [role="treeitem"]') !== null);
	await applyMerge();
	await applySwap();
	await applyPan();
	await applyJumps();
	await applySelect();
	await settle();
	document.body.dataset.previewReady = 'true';
	publishAudit();
}

void run();
