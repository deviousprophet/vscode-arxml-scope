/**
 * Static webview shells.
 *
 * The host writes these once per panel: strict CSP, the bundled script and the
 * bundled stylesheet exposed through `asWebviewUri`. No model data, no inline
 * script and no serialized function lives in the HTML.
 */
import { renderContextMenuHtml, renderContextMenuStyleTag } from '../webview/components/contextMenu/contextMenu';
import { renderDiffViewHtml } from '../webview/components/diffView/diffView';
import { renderSearchBarHtml } from '../webview/components/searchBar/searchBar';
import { renderSidebarHtml } from '../webview/components/sidebar/sidebar';
import { renderDiffToolbarHtml, renderEditorToolbarHtml } from '../webview/components/toolbar/toolbar';

export interface WebviewShellAssets {
	/** `webview.cspSource`. */
	cspSource: string;
	/** The bundled page script URI. */
	scriptUri: string;
	/** The bundled stylesheet URI (component CSS is inside it). */
	styleUri: string;
	/** A per-panel nonce for the script tag. */
	nonce: string;
}

function csp(assets: WebviewShellAssets): string {
	return [
		"default-src 'none'",
		`style-src ${assets.cspSource} 'nonce-${assets.nonce}'`,
		`script-src 'nonce-${assets.nonce}'`,
		`img-src ${assets.cspSource} data:`,
	].join('; ');
}

function head(assets: WebviewShellAssets, title: string): string {
	return `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(assets)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${assets.styleUri}">
<title>${title}</title>`;
}

function script(assets: WebviewShellAssets): string {
	return `<script nonce="${assets.nonce}" src="${assets.scriptUri}"></script>`;
}

/** The editor page shell: toolbar, Document tree region, sidebar and row menu. */
export function editorShell(assets: WebviewShellAssets): string {
	const searchHtml = renderSearchBarHtml('', 'Search the ECUC tree');
	return `<!DOCTYPE html>
<html lang="en">
<head>
${head(assets, 'ARXML Scope')}
</head>
<body data-view="document">
${renderEditorToolbarHtml(searchHtml)}
<div id="content">
<div id="main">
<div id="tree-measure" aria-hidden="true"><div class="probe-doc"><span class="row k-parameter has-value"><span class="label">x</span><span class="value"><span class="punct">=</span> <span class="value-text">0</span></span></span></div></div>
<div id="tree" class="document-tree" role="tree" aria-label="ECUC values"></div>
</div>
${renderSidebarHtml()}
</div>
${renderContextMenuHtml()}
${renderContextMenuStyleTag(assets.nonce)}
${script(assets)}
</body>
</html>`;
}

/** The diff page shell: toolbar, notice strip and the two-pane grid. */
export function diffShell(assets: WebviewShellAssets): string {
	const searchHtml = renderSearchBarHtml('diff-', 'Search the diff');
	return `<!DOCTYPE html>
<html lang="en">
<head>
${head(assets, 'ARXML Scope Diff')}
</head>
<body data-view="document" data-page="diff">
${renderDiffToolbarHtml(searchHtml)}
<div id="diff-notice" class="notice" role="status" aria-live="polite"></div>
${renderDiffViewHtml()}
${script(assets)}
</body>
</html>`;
}
