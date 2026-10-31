/** Pure markup for the two-pane comparison surface: the grid, the hidden height probe and the empty state. */
export function renderDiffViewHtml(): string {
	return `<div id="diff-body">
<div id="diff-list" class="diff-panes" role="presentation">
<div id="diff-pane-left" class="document-tree diff-pane" role="tree" aria-label="Semantic ECUC diff, left side"></div>
<div id="diff-pane-right" class="document-tree diff-pane" role="group" aria-label="Semantic ECUC diff, right side"></div>
</div>
<div id="diff-measure" aria-hidden="true"><span id="diff-ch-probe" class="ch-probe">${'0'.repeat(100)}</span><div class="diff-row probe"><div class="diff-cell"><span class="row"><span class="label">x</span></span></div></div></div>
<div id="diff-empty" class="empty" hidden><p id="diff-empty-text"></p></div>
</div>`;
}
