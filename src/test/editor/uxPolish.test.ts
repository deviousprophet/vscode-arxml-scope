/**
 * AC4, AC6–AC9 — the details inspector, the two-line grid, the source positions, the
 * details toggle and the filter/empty-state feedback.
 *
 * There is no webview DOM in the test host, so the assertions are on the row data, the
 * shell, and the page's own inline script. The DOM pass — a click filling the panel, a
 * re-scan not destroying it, hover/focus — is observed in the browser harness and
 * recorded in `implement.md`; it is not implied here.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { LineIndex } from '../../core/text/offsets';
import { RowPayload, inspectorFields, renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { repoRoot } from './editorTestUtils';
import { functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function text(): string {
	return fixtureText(FIXTURE);
}

function page(): string {
	const source = text();
	return renderHtml(scanEcucValues(source), { nonce: 'test-nonce', lineIndex: new LineIndex(source) });
}

function payload(source = page()): RowPayload {
	const match = /<script type="application\/json" id="ecuc-rows"[^>]*>([\s\S]*?)<\/script>/.exec(source);
	assert.ok(match, 'the page embeds the row document');
	return JSON.parse(match[1]) as RowPayload;
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

suite('editor visual polish (AC4, AC6–AC9)', () => {
	test('AC4: the page has a details inspector outside the virtual tree region', () => {
		const html = page();
		assert.ok(html.includes('<aside id="inspector" class="inspector" role="region" aria-label="Node details" hidden>'));
		assert.ok(html.includes('id="details-toggle"'));
		assert.ok(html.includes('aria-controls="inspector"'));
		assert.ok(/id="details-toggle"[^>]*aria-pressed="false"/.test(html));
		assert.ok(/id="view-toggle"[^>]*aria-pressed="true"/.test(html));
		assert.ok(html.includes('Select a line to see its details.'));
		assert.ok(html.includes('Click a line or press Space.'));
		assert.ok(html.includes('id="tree-window"'), 'the tree region is the virtual window');
		assert.ok(!html.slice(html.indexOf('id="ecuc-rows"')).includes('id="inspector"'), 'the row payload has no shell');
	});

	test('AC4: every row carries the definition path, short name and value the panel needs', () => {
		const rows = payload().rows;
		const contA = rows.find((row) => row.definitionRef === '/PkgA/PkgB/ModDefs/ModX/ContA')!;
		assert.strictEqual(contA.shortName, 'ContA');
		const ini = rows.find((row) => row.label === 'IniValue')!;
		assert.strictEqual(ini.value, '63');
		const peer = rows.find((row) => row.label === 'PeerRef')!;
		assert.strictEqual(peer.target, '/PkgA/PkgB/ModX/ContA/ContB');

		const script = page();
		const build = functionSource(script, 'buildNodeRow');
		for (const field of [
			"node.dataset.definitionRef = row.definitionRef",
			"node.dataset.shortName = row.shortName || ''",
			"node.dataset.value = row.value || ''",
			"node.dataset.target = row.target || ''",
		]) {
			assert.ok(build.includes(field), field);
		}
	});

	test('AC4: the source range is derived from LineIndex, not from the displayed order', () => {
		const source = text();
		const model = scanEcucValues(source);
		const index = new LineIndex(source);
		const parameter = model.modules[0].containers[0].parameters.find((candidate) => candidate.name === 'IniValue');
		assert.ok(parameter, 'the fixture has IniValue');
		const start = index.positionAt(parameter.range.start);
		const end = index.positionAt(parameter.range.end);
		const row = payload().rows.find((candidate) => candidate.label === 'IniValue')!;
		assert.strictEqual(row.sourceLine, start.line + 1, 'the gutter line is 1-based');
		assert.strictEqual(row.line, start.line, 'the inspector line is 0-based');
		assert.strictEqual(row.column, start.character);
		assert.strictEqual(row.endLine, end.line);
		assert.strictEqual(row.endColumn, end.character);
		const build = functionSource(page(), 'buildNodeRow');
		assert.ok(build.includes('node.dataset.line = String(row.line)'));
		assert.ok(!build.includes('data-range-start'), 'the unused raw range is not duplicated');
	});

	test('AC4: the inspector reads row data and posts reveal/copy, with no innerHTML', () => {
		const html = page();
		const rows = payload(html).rows;
		const parameter = rows.find((row) => row.label === 'IniValue')!;
		const fields = inspectorFields(parameter);
		assert.strictEqual(fields.definitionRef, '/PkgA/PkgB/ModDefs/ModX/ContA/IniValue');
		assert.strictEqual(fields.value, '63');
		assert.strictEqual(fields.hex, '(= 0x3F)');
		assert.strictEqual(fields.source!.line, parameter.line);
		const reference = rows.find((row) => row.label === 'PeerIref')!;
		assert.deepStrictEqual(reference.contextPaths, ['PkgA.PkgB.ModX.ContA']);
		assert.strictEqual(inspectorFields(reference).context, 'PkgA.PkgB.ModX.ContA');

		const update = functionSource(html, 'updateInspector');
		for (const field of [
			'Definition',
			'Short name',
			'Variant',
			'Value',
			'Hexadecimal',
			'Target',
			'Context',
			'Conditions',
			'Annotations',
			'Source',
			'Reveal in source',
			'Copy path',
			'Copy value',
		]) {
			assert.ok(update.includes(`'${field}'`), field);
		}
		assert.ok(update.includes('rowById.get(selectedId)'), 'the panel selects from the row map');
		assert.ok(!update.includes('querySelector'), 'and never from the rendered DOM');
		assert.ok(update.includes("vscode.postMessage({ type: 'copy', text: path })"));
		assert.ok(update.includes("vscode.postMessage({ type: 'copy', text: valueText })"));
		assert.ok(update.includes('revealItem(row.id)'));
		assert.ok(update.includes('data.source.line + 1'), 'the display line is one-based');
		assert.ok(update.includes("inspector.textContent = ''"), 'the panel is rebuilt from text nodes');
		assert.ok(!update.includes('innerHTML'), 'model text is never inserted as markup');
	});

	test('AC4/AC8: selection and a re-scan update the panel; the toggle controls it', () => {
		const html = page();
		const select = functionSource(html, 'setSelection');
		assert.ok(select.includes('updateInspector()'), 'a selection fills the panel');
		assert.ok(select.includes('element.dataset.selected'), 'the row state is updated in the window');

		// The initial selection is data in the payload, and prepareFocus scrolls/renders
		// it before the first paint; the panel is filled from the row map.
		const model = scanEcucValues(text());
		const id = payload().rows.find((row) => row.label === 'IniValue')!.id;
		const selectedPage = renderHtml(model, { nonce: 'test-nonce', selectedId: id });
		assert.strictEqual(payload(selectedPage).selectedId, id);
		const prepare = functionSource(selectedPage, 'prepareFocus');
		assert.ok(prepare.includes('focusRow(selectedId)'), 'the host selection is rendered/focused');
		assert.ok(selectedPage.lastIndexOf('prepareFocus();') > selectedPage.indexOf('setRows(initial.rows'));

		const script = html;
		const modelAt = script.lastIndexOf("if (message.type === 'model')");
		const applyAt = script.indexOf('setRows(message.rows', modelAt);
		const updateAt = script.indexOf('updateInspector();', applyAt);
		const nextBranchAt = script.indexOf('} else if (message.type', applyAt);
		assert.ok(
			modelAt !== -1 && applyAt !== -1 && updateAt !== -1 && nextBranchAt !== -1 && updateAt < nextBranchAt,
			'a re-scan refreshes the panel'
		);
		assert.ok(script.includes("detailsToggle.addEventListener('click'"));
		assert.ok(script.includes('viewState.inspectorHidden = !viewState.inspectorHidden'));
		assert.ok(script.includes('applyInspectorVisibility()'));
		assert.ok(script.includes("detailsToggle.setAttribute('aria-pressed'"));
		assert.ok(script.includes("viewToggle.addEventListener('click', toggleView)"));
		assert.ok(script.includes('viewState.view'));
		assert.ok(script.includes('vscode.getState()'), 'the panel preference is restored on a reload');
		assert.ok(script.includes('vscode.setState(viewState)'), 'and saved through the host state');
	});

	test('AC6: rows are a two-line grid and .value stays a direct child of .row', () => {
		const script = page();
		const build = functionSource(script, 'buildNodeRow');
		const value = functionSource(script, 'valueSpan');
		assert.ok(build.includes("'row k-' + row.kind"), 'the kind classes');
		assert.ok(build.includes("row.shownValue !== undefined ? ' has-value' : ' no-value'"));
		assert.ok(build.includes('rowElement.appendChild(valueSpan(row))'), 'the value is appended directly to .row');
		assert.ok(value.includes("value.className = row.kind === 'reference' ? 'value target' : 'value'"));
		assert.ok(value.includes("text.className = 'value-text'"));
		assert.ok(build.includes("const meta = document.createElement('span')") || build.includes('metaSpan(row)'));
		assert.ok(functionSource(script, 'metaSpan').includes("span.className = part.cls"));
		assert.ok(functionSource(script, 'metaSpan').includes('span.title = part.title'));

		const style = styleOf(script);
		assert.ok(style.includes('grid-template-columns: 12px 12px 26ch minmax(0, 1fr)'));
		assert.ok(/\.row\.no-value \.label\s*\{[^}]*grid-column:\s*3\s*\/\s*-1/.test(style));
		assert.ok(/\.row-meta\s*\{[^}]*grid-column:\s*3\s*\/\s*-1/.test(style));
		assert.ok(/\.row-meta > span\s*\{[^}]*text-overflow:\s*ellipsis/.test(style), 'metadata ellipsizes');
		assert.ok(/\.label\s*\{[^}]*text-overflow:\s*ellipsis/.test(style));
		assert.ok(/\.value\s*\{[^}]*text-overflow:\s*ellipsis/.test(style));
	});

	test('AC7: the filter has a clear button, a count state and an empty state', () => {
		const html = page();
		assert.ok(html.includes('id="filter-clear"'));
		assert.ok(html.includes('id="count"') && html.includes('data-state="none"'));
		assert.ok(html.includes('id="empty"'));
		assert.ok(html.includes('id="empty-text"'));
		assert.ok(html.includes('id="empty-clear"'));
		const apply = functionSource(html, 'updateFilterUi');
		assert.ok(apply.includes("countLabel.dataset.state = 'none'"));
		assert.ok(apply.includes("countLabel.dataset.state = 'empty'"));
		assert.ok(apply.includes("countLabel.dataset.state = 'filtered'"));
		assert.ok(apply.includes("clearButton.hidden = filterInput.value.trim() === ''"));
		assert.ok(apply.includes("emptyText.textContent = '/* No entities match \"' + filterInput.value.trim() + '\". */'"));
		assert.ok(html.includes("event.target.closest('#empty-clear')"), 'the empty clear is delegated');
	});

	test('AC7: the filter highlights label, short name and value through the shared matchRanges', () => {
		const html = page();
		const highlight = functionSource(html, 'appendHighlighted');
		assert.ok(highlight.includes('matchRanges('), 'the one definition of a match is used');
		assert.ok(highlight.includes("document.createElement('mark')"), 'a real highlight element');
		assert.ok(!highlight.includes('dataset.highlighted'), 'rows are rebuilt for each window, so no restore dance');
		const build = functionSource(html, 'buildNodeRow');
		assert.ok(build.includes('appendHighlighted(label, row.label)'));
		assert.ok(functionSource(html, 'valueSpan').includes("appendHighlighted(text, row.shownValue || '')"));
		assert.ok(functionSource(html, 'metaSpan').includes("appendHighlighted(span, part.text)"), 'the short name');
		assert.ok(!html.includes("document.querySelectorAll('#tree [role=\"treeitem\"]')"), 'no DOM-wide scan');
	});

	test('AC9: selection uses a quiet tint and keeps token colours', () => {
		const style = styleOf(page());
		assert.ok(/--sel-bg:\s*color-mix\([^;]*--vscode-list-inactiveSelectionBackground/.test(style));
		assert.ok(/--sel-bg-focus:\s*color-mix\([^;]*--vscode-list-activeSelectionBackground/.test(style));
		assert.ok(
			/\.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg\)/.test(style)
		);
		assert.ok(
			/#tree:focus-within \.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(
				style
			)
		);
		assert.ok(!style.includes('--ecuc-selection-fg'), 'selection never recolours syntax');
	});

	test('AC9: fonts have usable fallbacks and no colour literal was introduced', () => {
		const style = styleOf(page());
		assert.ok(style.includes('font-family: var(--vscode-font-family,'));
		assert.ok(style.includes('font-family: var(--vscode-editor-font-family,'));
		const hexes = [...style.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(hexes, ['#80808040'], 'the indent-guide fallback is the only literal');
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		assert.strictEqual(pkg.dependencies, undefined, 'no runtime dependency');
	});
});
