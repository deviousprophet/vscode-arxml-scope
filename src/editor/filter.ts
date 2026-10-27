/**
 * Client-side filter over the rendered tree (child design §2.5; UX child design §7).
 *
 * `haystack` is the single owner of "what a node is searched by" — label, short-name
 * and value — and `renderHtml` writes its result into a `data-haystack` attribute.
 * The webview therefore never re-derives which fields are searched: it only compares
 * the lower-cased query against an attribute the host already built, so the two sides
 * cannot drift.
 *
 * `matchRanges` is the single owner of "what counts as a match": filtering (here and in
 * the webview) and the `<mark>` highlighting both call it, so the two cannot disagree
 * about why a row is shown (UX child design §7).
 *
 * `filterTree` is the same algorithm over data instead of DOM, and is what the tests
 * exercise.
 */
export interface FilterFields {
	label: string;
	shortName?: string;
	value?: string;
}

/** Lower-cased search text: label, short-name and value, space separated. */
export function haystack(node: FilterFields): string {
	return [node.label, node.shortName ?? '', node.value ?? '']
		.filter((part) => part !== '')
		.join(' ')
		.toLowerCase();
}

/** An occurrence of the query, as `[start, end)` offsets into the searched text. */
export interface MatchRange {
	start: number;
	end: number;
}

/**
 * Every case-insensitive occurrence of `query` in `text`. The empty query matches
 * nothing, so the caller decides what "no filter" means. Serialized into the webview
 * with `toString()`, so filtering and highlighting share this one definition.
 */
export function matchRanges(text: string, query: string): MatchRange[] {
	const needle = query.trim().toLowerCase();
	if (needle === '') {
		return [];
	}
	const lower = text.toLowerCase();
	const ranges: MatchRange[] = [];
	let at = lower.indexOf(needle);
	while (at !== -1) {
		ranges.push({ start: at, end: at + needle.length });
		at = lower.indexOf(needle, at + needle.length);
	}
	return ranges;
}

/** True when `query` is empty, or appears in the node's label, short-name or value. */
export function matchesQuery(node: FilterFields, query: string): boolean {
	return query.trim() === '' || matchRanges(haystack(node), query).length > 0;
}

export interface FilterNode extends FilterFields {
	children?: FilterNode[];
}

/**
 * Keeps nodes that match, plus the ancestors of a match, at every level. An empty
 * query keeps the whole tree.
 */
export function filterTree(nodes: readonly FilterNode[], query: string): FilterNode[] {
	const kept: FilterNode[] = [];
	for (const node of nodes) {
		const children = node.children ? filterTree(node.children, query) : undefined;
		if (matchesQuery(node, query) || (children?.length ?? 0) > 0) {
			kept.push(children ? { ...node, children } : { ...node });
		}
	}
	return kept;
}

/**
 * The webview half of the filter: the input box, the count, the visibility pass it
 * drives, and the `<mark>` highlighting (UX child design §7). `data-haystack` is the
 * only field knowledge the view needs, and `matchRanges` is the only definition of a
 * match — the same function the host-side `matchesQuery` uses.
 */
export function filterScript(): string {
	return `
	const filterInput = document.getElementById('filter');
	const countLabel = document.getElementById('count');
	const clearButton = document.getElementById('filter-clear');
	${matchRanges.toString()}

	/** The spans a match can be highlighted in: the three fields the haystack carries. */
	function highlightableSpans(item) {
		return Array.from(
			item.querySelectorAll(':scope > .row > .label, :scope > .row > .row-meta .short, :scope > .row > .value')
		);
	}

	function highlightSpan(span, needle) {
		const original = span.dataset.text !== undefined ? span.dataset.text : span.textContent;
		span.dataset.text = original;
		const ranges = matchRanges(original, needle);
		if (ranges.length === 0) {
			if (span.dataset.highlighted === 'true') {
				span.textContent = original;
				delete span.dataset.highlighted;
			}
			return;
		}
		span.textContent = '';
		let at = 0;
		for (const range of ranges) {
			if (range.start > at) {
				span.appendChild(document.createTextNode(original.slice(at, range.start)));
			}
			const mark = document.createElement('mark');
			mark.textContent = original.slice(range.start, range.end);
			span.appendChild(mark);
			at = range.end;
		}
		if (at < original.length) {
			span.appendChild(document.createTextNode(original.slice(at)));
		}
		span.dataset.highlighted = 'true';
	}

	function applyFilter() {
		const needle = filterInput.value.trim().toLowerCase();
		const items = Array.from(document.querySelectorAll('#tree [role="treeitem"]'));
		// The empty block is part of the swapped tree region, so it is looked up fresh on
		// every pass; a node captured at load would be detached after a re-scan.
		const empty = document.getElementById('empty');
		const emptyText = document.getElementById('empty-text');
		if (clearButton) {
			clearButton.hidden = filterInput.value.trim() === '';
		}
		const visible = new Map();
		// Ancestors of a match are expanded while the filter is active, so a match inside
		// a collapsed subtree is reachable (design §4.4). The collapsed set itself is
		// untouched, which is what makes clearing the filter restore it.
		const ancestors = new Set();
		let shown = 0;
		for (let i = items.length - 1; i >= 0; i--) {
			const item = items[i];
			const self = needle === '' || matchRanges(item.dataset.haystack, needle).length > 0;
			let descendant = false;
			const group = item.querySelector(':scope > [role="group"]');
			if (group) {
				for (const child of group.children) {
					if (visible.get(child)) {
						descendant = true;
						break;
					}
				}
			}
			const show = self || descendant;
			visible.set(item, show);
			item.style.display = show ? '' : 'none';
			if (show) {
				shown++;
			}
			if (show && descendant && !self) {
				ancestors.add(item.dataset.nodeId);
			}
			if (show) {
				for (const span of highlightableSpans(item)) {
					highlightSpan(span, needle);
				}
			}
		}
		if (needle === '') {
			countLabel.textContent = '';
			countLabel.dataset.state = 'none';
			if (empty) {
				empty.hidden = true;
			}
		} else if (shown === 0) {
			countLabel.textContent = 'No matches';
			countLabel.dataset.state = 'empty';
			if (empty) {
				empty.hidden = false;
			}
			if (emptyText) {
				emptyText.textContent = 'No matches for "' + filterInput.value.trim() + '".';
			}
		} else {
			countLabel.textContent = shown + ' of ' + items.length;
			countLabel.dataset.state = 'filtered';
			if (empty) {
				empty.hidden = true;
			}
		}
		applyCollapsed(ancestors);
	}

	filterInput.addEventListener('input', applyFilter);
	filterInput.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			filterInput.value = '';
			applyFilter();
		}
	});
	if (clearButton) {
		clearButton.addEventListener('click', () => {
			filterInput.value = '';
			applyFilter();
			filterInput.focus();
		});
	}
	// Delegated so the button keeps working after a re-scan swaps the empty block.
	document.addEventListener('click', (event) => {
		if (event.target && event.target.closest && event.target.closest('#empty-clear')) {
			filterInput.value = '';
			applyFilter();
			filterInput.focus();
		}
	});
`;
}
