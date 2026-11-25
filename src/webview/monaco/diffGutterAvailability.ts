import { IContextKeyService } from 'monaco-editor/platform/contextkey/common/contextkey.js';
import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices.js';
import {
	COPY_LEFT_CONTEXT,
	COPY_RIGHT_CONTEXT,
	type DiffGutterMapping
} from './diffGutterActions';

interface GutterAvailability {
	left: boolean;
	right: boolean;
}

export interface GutterAvailabilityHost {
	availability(mapping: DiffGutterMapping): GutterAvailability;
}

interface ScopedKeys {
	left: { set(value: boolean): void };
	right: { set(value: boolean): void };
}

interface GutterItemElement extends HTMLElement {
	__arxmlGutterItem?: { mapping?: DiffGutterMapping };
}

interface GutterButtonsElement extends HTMLElement {
	__arxmlContextKeyService?: IContextKeyService;
}

const scopedKeys = new WeakMap<IContextKeyService, ScopedKeys>();

function createScopedKeys(service: IContextKeyService): ScopedKeys {
	const existing = scopedKeys.get(service);
	if (existing !== undefined) {
		return existing;
	}
	const keys: ScopedKeys = {
		left: service.createKey(COPY_LEFT_CONTEXT, true),
		right: service.createKey(COPY_RIGHT_CONTEXT, true)
	};
	scopedKeys.set(service, keys);
	return keys;
}

function globalKeys(): ScopedKeys {
	const service = StandaloneServices.get<IContextKeyService>(IContextKeyService);
	return createScopedKeys(service);
}

function gutterItems(): GutterItemElement[] {
	return Array.from(document.querySelectorAll<GutterItemElement>('.monaco-diff-editor .gutterItem'));
}

function itemValues(
	item: GutterItemElement,
	host: GutterAvailabilityHost
): GutterAvailability | null {
	const mapping = item.__arxmlGutterItem?.mapping;
	return mapping === undefined ? null : host.availability(mapping);
}

function applyAvailability(
	item: GutterItemElement,
	host: GutterAvailabilityHost
): void {
	const buttons = item.querySelector<GutterButtonsElement>('.buttons');
	const service = buttons?.__arxmlContextKeyService;
	const values = itemValues(item, host);
	if (service === undefined || values === null) {
		return;
	}
	const keys = createScopedKeys(service);
	keys.left.set(values.left);
	keys.right.set(values.right);
}

function snapshotItem(item: GutterItemElement, host: GutterAvailabilityHost): unknown {
	const buttons = item.querySelector<GutterButtonsElement>('.buttons');
	return {
		hasItem: item.__arxmlGutterItem !== undefined,
		hasService: buttons?.__arxmlContextKeyService !== undefined,
		mapping: item.__arxmlGutterItem?.mapping ?? null,
		values: itemValues(item, host),
		buttons: item.querySelectorAll('.action-label').length
	};
}

function previewSnapshot(host: GutterAvailabilityHost): unknown[] {
	return gutterItems().map((item) => snapshotItem(item, host));
}

/**
 * Keep the global menu non-empty so the gutter/sash stay mounted, and set the
 * per-item scoped context keys created by the checked-in Monaco patch.
 */
export function installGutterAvailability(host: GutterAvailabilityHost): {
	sync(): void;
	dispose(): void;
} {
	const globals = globalKeys();
	globals.left.set(true);
	globals.right.set(true);
	let frame: number | undefined;
	const sync = (): void => {
		frame = undefined;
		for (const item of gutterItems()) {
			applyAvailability(item, host);
		}
		if ((window as unknown as { __PREVIEW__?: unknown }).__PREVIEW__ !== undefined) {
			(window as unknown as { __ARXML_GUTTER_PROBE__?: unknown }).__ARXML_GUTTER_PROBE__ =
				previewSnapshot(host);
		}
	};
	const schedule = (): void => {
		if (frame !== undefined) {
			return;
		}
		frame = window.requestAnimationFrame(sync);
	};
	const observer = new MutationObserver(schedule);
	observer.observe(document.body, { childList: true, subtree: true });
	schedule();
	return {
		sync,
		dispose(): void {
			observer.disconnect();
			if (frame !== undefined) {
				window.cancelAnimationFrame(frame);
			}
		}
	};
}
