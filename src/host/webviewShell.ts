/**
 * Static webview shells.
 *
 * The host writes these once per panel: strict CSP, the bundled script and the
 * bundled stylesheet exposed through `asWebviewUri`. No model data, no inline
 * script and no serialized function lives in the HTML.
 */
import { renderContextMenuHtml, renderContextMenuStyleTag } from '../webview/components/contextMenu/contextMenu';
import { renderDiffViewHtml } from '../webview/components/diffView/diffView';
import { renderSidebarHtml } from '../webview/components/sidebar/sidebar';
import { renderDiffToolbarHtml, renderEditorToolbarHtml } from '../webview/components/toolbar/toolbar';

export interface WebviewShellAssets {
	/** `webview.cspSource`. */
	cspSource: string;
	/** The bundled page script URI. */
	scriptUri: string;
	/** The bundled stylesheet URI (component CSS is inside it). */
	styleUri: string;
	/** The bundled Monaco worker URI. */
	workerUri?: string;
	/** A per-panel nonce for the script tag. */
	nonce: string;
}

function csp(assets: WebviewShellAssets): string {
	const source = assets.cspSource || "'self'";
	return [
		"default-src 'none'",
		// Monaco injects its styles at runtime and does not accept a nonce.
		`style-src ${source} 'unsafe-inline'`,
		`script-src 'nonce-${assets.nonce}'`,
		`img-src ${source} data:`,
		// The codicon font is a packaged asset.
		`font-src ${source} data:`,
		// The worker source is fetched and started from a blob.
		`connect-src ${source}`,
		`worker-src ${source} blob:`,
		`child-src ${source} blob:`,
	].join('; ');
}

function head(assets: WebviewShellAssets, title: string): string {
	const worker = assets.workerUri
		? `\n<meta name="arxml-worker-uri" content="${assets.workerUri}">`
		: '';
	return `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(assets)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">${worker}
<link rel="stylesheet" href="${assets.styleUri}">
<title>${title}</title>`;
}

function script(assets: WebviewShellAssets): string {
	return `<script nonce="${assets.nonce}" src="${assets.scriptUri}"></script>`;
}

/** The editor page shell: toolbar, Document tree region, sidebar and row menu. */
export function editorShell(assets: WebviewShellAssets): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
${head(assets, 'ARXML Scope')}
</head>
<body data-view="document">
${renderEditorToolbarHtml()}
<div id="editor-error-strip" class="editor-error-strip" role="alert" hidden></div>
<div id="editor-stale-banner" class="editor-stale-banner" role="alert" hidden>
<span id="editor-stale-message" class="editor-stale-message">This row is no longer in the file.</span>
<span class="editor-stale-actions">
<button id="editor-stale-discard" class="tool" type="button">Discard draft</button>
<button id="editor-stale-reload" class="tool" type="button">Reload</button>
</span>
</div>
<div id="content">
<div id="main">
<div id="tree-measure" aria-hidden="true"><span id="tree-ch-probe" class="ch-probe">${'0'.repeat(100)}</span><div class="probe-doc"><span class="row k-parameter has-value"><span class="label">x</span><span class="value"><span class="punct">=</span> <span class="value-text">0</span></span></span></div></div>
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
	return `<!DOCTYPE html>
<html lang="en">
<head>
${head(assets, 'ARXML Scope Diff')}
</head>
<body data-view="document" data-page="diff">
${renderDiffToolbarHtml()}
<div id="diff-notice" class="notice" role="status" aria-live="polite"></div>
${renderDiffViewHtml()}
${script(assets)}
</body>
</html>`;
}
