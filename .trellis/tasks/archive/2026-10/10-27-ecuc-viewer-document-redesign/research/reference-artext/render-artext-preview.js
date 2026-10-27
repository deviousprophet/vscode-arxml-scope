'use strict';

// Throwaway research renderer: apply the reference ARTEXT TextMate scopes to the
// post-processed .artext file, using VS Code Dark+ token colours. Not part of the extension.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'display-rules.artext');
const out = path.join(__dirname, 'display-rules-highlighted.html');
const text = fs.readFileSync(file, 'utf8');

function escapeHtml(value) {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(kind, value) {
	return `<span class="t-${kind}">${escapeHtml(value)}</span>`;
}

// Ordered like the grammar: comments and strings first, then keywords/booleans,
// numbers, dotted entity paths, names before '=' or an operator.
const TOKEN = new RegExp(
	'(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*$)' +
		'|("(?:\\\\.|[^"\\\\])*")' +
		'|\\b(schema|package|module|context)\\b' +
		'|\\b(true|false|True|False|TRUE|FALSE)\\b' +
		'|\\b0[xX][0-9a-fA-F]+\\b' +
		'|\\b\\d+(?:\\.\\d+)?\\b' +
		'|\\(([A-Za-z_]\\w*)\\)' +
		'|\\b(?:[0-9A-Za-z_]\\w*\\.)+[0-9A-Za-z_]\\w*\\b' +
		'|\\b([0-9A-Za-z_]\\w*)\\b(?=\\s*")' +
		'|\\b([0-9A-Za-z_]\\w*)\\b(?=\\s*=)' +
		'|\\b([A-Za-z_]\\w*)\\b(?=\\s*(?:==|!=|>=|<=|>|<|&&|\\|\\|))',
	'gm'
);

function highlightLine(line) {
	let result = '';
	let last = 0;
	for (const match of line.matchAll(TOKEN)) {
		const at = match.index;
		result += escapeHtml(line.slice(last, at));
		const value = match[0];
		let kind = 'plain';
		if (match[1]) kind = 'comment';
		else if (match[2]) kind = 'string';
		else if (match[3]) kind = 'keyword';
		else if (match[4]) kind = 'boolean';
		else if (/^0x/i.test(value)) kind = 'number';
		else if (/^\d/.test(value)) kind = 'number';
		else if (match[5]) kind = 'variant';
		else if (match[6]) kind = 'entity';
		else if (match[7]) kind = 'type';
		else if (match[8]) kind = 'variable';
		else if (match[9]) kind = 'variable';
		result += span(kind, value);
		last = at + value.length;
	}
	result += escapeHtml(line.slice(last));
	return result;
}

const lines = text.split('\n');
const body = lines
	.map((line, index) => `<span class="ln">${String(index + 1).padStart(3, ' ')}</span>  ${highlightLine(line)}`)
	.join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Reference ARTEXT — post-processed</title>
<style>
	:root {
		color-scheme: dark;
		--bg: #1e1e1e;
		--fg: #d4d4d4;
		--muted: #858585;
		--comment: #6a9955;
		--keyword: #569cd6;
		--string: #ce9178;
		--number: #b5cea8;
		--boolean: #569cd6;
		--entity: #dcdcaa;
		--type: #4ec9b0;
		--variable: #9cdcfe;
		--variant: #c586c0;
		--border: #333333;
		--panel: #252526;
	}
	body {
		margin: 0;
		background: var(--bg);
		color: var(--fg);
		font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
		font-size: 13px;
		line-height: 1.55;
	}
	.note {
		padding: 10px 14px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		color: var(--muted);
		font-family: "Segoe UI", sans-serif;
		font-size: 12px;
	}
	.note strong { color: var(--fg); font-weight: 600; }
	pre {
		margin: 0;
		padding: 12px 14px 24px;
		white-space: pre;
		tab-size: 4;
	}
	.ln {
		display: inline-block;
		width: 3ch;
		margin-right: 1ch;
		color: #5a5a5a;
		text-align: right;
		user-select: none;
	}
	.t-comment { color: var(--comment); }
	.t-keyword { color: var(--keyword); }
	.t-string { color: var(--string); }
	.t-number { color: var(--number); }
	.t-boolean { color: var(--boolean); }
	.t-entity { color: var(--entity); }
	.t-type { color: var(--type); }
	.t-variable { color: var(--variable); }
	.t-variant { color: var(--variant); }
</style>
</head>
<body>
<div class="note"><strong>Reference:</strong> post-processed <code>.artext</code> from <code>Arxml2Artext</code>, coloured with the reference grammar’s scopes and VS Code Dark+ token colours. This is the look being compared, not the current custom viewer.</div>
<pre>${body}</pre>
</body>
</html>`;

fs.writeFileSync(out, html, 'utf8');
console.log(out);
