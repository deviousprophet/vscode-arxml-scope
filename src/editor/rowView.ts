/**
 * The row primitives shared by every webview that shows an ECUC row.
 *
 * `appendHighlighted`, `valueSpan` and `metaSpan` are page functions: they run in
 * the webview, are serialized with `Function.prototype.toString()` and are never
 * executed on the host. Keeping them here means the editor page and the diff page
 * render the same label, `= value` and meta chips from one definition instead of
 * two copies that can drift.
 *
 * The functions deliberately use only `document` and the field subset they read,
 * so both an `EcucRow` and a projected diff cell satisfy them. `appendHighlighted`
 * falls back to the page's `highlightQuery` while a search is active, and otherwise
 * to `filterQuery`; each page declares both variables.
 */

/** The subset `valueSpan` / `metaSpan` read from a row or a projected diff cell. */
export interface RowViewFields {
	kind: string;
	valueKind?: string;
	shownValue?: string;
	meta: readonly { cls: string; text: string; title: string; state?: string }[];
}

/** The tiny DOM surface the page functions use; the host never calls them. */
interface PageElement {
	appendChild(child: unknown): void;
}

declare const document: {
	createElement(tag: string): {
		className: string;
		title: string;
		dataset: Record<string, string>;
		textContent: string;
		appendChild(child: unknown): void;
	};
	createElementNS(namespace: string, tag: string): {
		setAttribute(name: string, value: string): void;
		appendChild(child: unknown): void;
	};
	createTextNode(text: string): unknown;
};

/* Page globals declared by the host page around this script. */
declare const filterQuery: string;
declare const highlightQuery: string;
declare function matchRanges(text: string, query: string): { start: number; end: number }[];

/** The Codicon chevron-right used by both tree row renderers (inline, no asset). */
export function twistyIcon(): unknown {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('class', 'g-twisty');
	svg.setAttribute('fill', 'currentColor');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	// Codicon chevron-right (MIT, microsoft/vscode-codicons).
	path.setAttribute('d', 'M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z');
	svg.appendChild(path);
	return svg;
}

/**
 * Appends `text` to `parent`, wrapping every case-insensitive occurrence of the
 * query in `<mark>`. With no explicit query the page's live `filterQuery` is used,
 * unless a non-blank `highlightQuery` overrides it for the active search.
 */
export function appendHighlighted(parent: PageElement, text: string, query?: string): void {
	const needle =
		query === undefined
			? typeof highlightQuery === 'string' && highlightQuery.trim() !== ''
				? highlightQuery
				: filterQuery
			: query;
	const ranges = needle.trim() === '' ? [] : matchRanges(text, needle);
	if (ranges.length === 0) {
		parent.appendChild(document.createTextNode(text));
		return;
	}
	let at = 0;
	for (const range of ranges) {
		if (range.start > at) {
			parent.appendChild(document.createTextNode(text.slice(at, range.start)));
		}
		const mark = document.createElement('mark');
		mark.textContent = text.slice(range.start, range.end);
		parent.appendChild(mark);
		at = range.end;
	}
	if (at < text.length) {
		parent.appendChild(document.createTextNode(text.slice(at)));
	}
}

/** The `= shownValue` span; the `=` is punctuation, not part of the value token. */
export function valueSpan(row: RowViewFields, readOnly = false): unknown {
	const value = document.createElement('span');
	value.className = 'value';
	if (row.kind === 'parameter') {
		value.dataset.valueKind = row.valueKind || 'textual';
		value.title = 'Value: ' + (row.shownValue || '') + (readOnly ? '' : ' - edit in Details');
	} else {
		value.title = 'Target: ' + (row.shownValue || '');
	}
	const punct = document.createElement('span');
	punct.className = 'punct';
	punct.textContent = '=';
	value.appendChild(punct);
	value.appendChild(document.createTextNode(' '));
	const text = document.createElement('span');
	text.className = 'value-text';
	appendHighlighted(text, row.shownValue || '');
	value.appendChild(text);
	return value;
}

/** The quiet-source meta chips (short name, variant, context, condition, annotation). */
export function metaSpan(row: RowViewFields): unknown {
	const meta = document.createElement('span');
	meta.className = 'row-meta';
	for (const part of row.meta) {
		const span = document.createElement('span');
		span.className = part.cls;
		span.title = part.title;
		if (part.state) {
			span.dataset.state = part.state;
		}
		if (part.cls === 'context' && part.text.indexOf('context ') === 0) {
			const keyword = document.createElement('span');
			keyword.className = 'keyword';
			keyword.textContent = 'context';
			span.appendChild(keyword);
			span.appendChild(document.createTextNode(' ' + part.text.slice('context '.length)));
		} else if (part.cls === 'short') {
			appendHighlighted(span, part.text);
		} else {
			span.textContent = part.text;
		}
		meta.appendChild(span);
	}
	return meta;
}

/** The page functions, serialized for a webview's classic script. */
export function rowViewScript(): string {
	return `${twistyIcon.toString()}${appendHighlighted.toString()}${valueSpan.toString()}${metaSpan.toString()}`;
}
