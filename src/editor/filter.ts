/**
 * Client-side filter over the rendered tree (child design §2.5).
 *
 * `haystack` is the single owner of "what a node is searched by" — label, short-name
 * and value — and `renderHtml` writes its result into a `data-haystack` attribute.
 * The webview therefore never re-derives which fields are searched: it only compares
 * the lower-cased query against an attribute the host already built, so the two sides
 * cannot drift.
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

/** True when `query` is empty, or appears in the node's label, short-name or value. */
export function matchesQuery(node: FilterFields, query: string): boolean {
	const needle = query.trim().toLowerCase();
	return needle === '' || haystack(node).includes(needle);
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
 * The webview half of the filter: the input box and the visibility pass it drives.
 * `data-haystack` is the only field knowledge the view needs.
 */
export function filterScript(): string {
	return `
	const filterInput = document.getElementById('filter');
	function applyFilter() {
		const needle = filterInput.value.trim().toLowerCase();
		const items = Array.from(document.querySelectorAll('#tree [role="treeitem"]'));
		const visible = new Map();
		for (let i = items.length - 1; i >= 0; i--) {
			const item = items[i];
			const self = needle === '' || item.dataset.haystack.includes(needle);
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
		}
	}
	filterInput.addEventListener('input', applyFilter);
`;
}
