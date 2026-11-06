/** Pure markup for the fixed diff chrome and the shared scroll surface. */
export function renderDiffViewHtml(): string {
	return `<div id="diff-body">
<div id="diff-title-strip" class="diff-title-strip" role="presentation">
<div id="diff-title-left" class="diff-title-cell" role="presentation"></div>
<div id="diff-title-right" class="diff-title-cell" role="presentation"></div>
</div>
<p id="diff-semantic-skip" class="diff-semantic-skip" hidden></p>
<div id="diff-list" class="diff-panes" role="presentation"></div>
<div id="diff-measure" aria-hidden="true"><span id="diff-ch-probe" class="ch-probe">${'0'.repeat(100)}</span><div class="diff-row probe"><div class="diff-cell"><span class="row"><span class="label">x</span></span></div></div></div>
<div id="diff-empty" class="empty" hidden><p id="diff-empty-text"></p></div>
</div>`;
}
