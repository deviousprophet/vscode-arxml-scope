/**
 * The Conditions panel and the page's disabled-row presentation (task design §6).
 *
 * There is no webview DOM in the test host. The assertions are on the rendered
 * shell, the escaped JSON payload, and the page's own inlined functions
 * extracted and compiled with `scriptTestUtils`, so the page and the tests
 * share one definition. The real page (focus, typing, theme, screen reader) is
 * observed in the Extension Development Host and recorded in the task notes.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { ConditionEntry, ConditionValueStore, isConditionName } from '../../editor/conditionValues';
import { EcucEditorProvider } from '../../editor/ecucEditorProvider';
import { encodeJsonForScript, inspectorFields, renderHtml } from '../../editor/renderHtml';
import { EcucRow, buildRows } from '../../editor/renderRows';
import { fixtureText } from '../core/modelTestUtils';
import { fixtureUri } from './editorTestUtils';
import { evaluateFunction, functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/syscond.arxml';

function model() {
	return scanEcucValues(fixtureText(FIXTURE));
}

function page(conditionEntries: readonly ConditionEntry[] = []): string {
	return renderHtml(model(), { nonce: 'test-nonce', conditionEntries });
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

function conditionPayload(html: string): unknown {
	const match = /<script type="application\/json" id="ecuc-conditions"[^>]*>([\s\S]*?)<\/script>/.exec(html);
	assert.ok(match, 'the page embeds the condition entries');
	return JSON.parse(match[1]);
}

function rowPayload(html: string): Array<{ label?: string; disabled?: boolean }> {
	const match = /<script type="application\/json" id="ecuc-rows"[^>]*>([\s\S]*?)<\/script>/.exec(html);
	assert.ok(match, 'the page embeds the row document');
	return JSON.parse(match[1]).rows;
}

/** Compiles the page's own functions, with the listed page globals injected. */
function compileWith<T>(
	html: string,
	names: readonly string[],
	args: readonly string[],
	values: readonly unknown[]
): T {
	const source = names.map((name) => functionSource(html, name)).join('\n');
	const factory = new Function(...args, `${source}\nreturn { ${names.join(', ')} };`);
	return factory(...values) as T;
}

interface FakeInput {
	value: string;
	setAttribute(name: string, value: string): void;
	attributes: Record<string, string>;
	focus?(): void;
	select?(): void;
}

function fakeInput(value: string): FakeInput {
	const attributes: Record<string, string> = {};
	return {
		value,
		attributes,
		setAttribute(name: string, attributeValue: string) {
			attributes[name] = attributeValue;
		},
	};
}

interface FakeRow {
	dataset: Record<string, string>;
	querySelector(selector: string): unknown;
}

/** A row with committed data; `parts` supplies the selectors a case needs. */
function fakeRow(dataset: Record<string, string>, parts: Record<string, unknown> = {}): FakeRow {
	return {
		dataset: { ...dataset },
		querySelector(selector: string) {
			return Object.prototype.hasOwnProperty.call(parts, selector) ? parts[selector] : null;
		},
	};
}

suite('conditions panel (design §6)', () => {
	test('the Conditions tab hosts the panel shell once, outside #tree', () => {
		const html = page();
		assert.ok(!html.includes('id="conditions-toggle"'), 'the toolbar toggle is removed');
		assert.ok(/id="stab-conditions"[^>]*role="tab"[^>]*aria-controls="sbp-conditions"/.test(html));
		assert.ok(html.includes('id="sbp-conditions"'), 'the tab panel exists');
		assert.ok(!/<div id="conditions-panel" class="conditions-panel" hidden>/.test(html), 'the tab controls visibility, not the panel');
		assert.ok(html.includes('<div id="conditions-panel" class="conditions-panel">'));
		assert.ok(html.includes('id="conditions-list"'));
		assert.ok(html.includes('id="conditions-add"'));
		assert.ok(html.includes('id="conditions-clear"'));
		assert.ok(html.includes('id="conditions-count"'));
		assert.ok(html.includes('id="sb-conditions-values-badge"'), 'the Conditions section header carries the count badge');
		assert.ok(!html.includes('id="conditions-values-count"'), 'the count is not duplicated inside the body');
		assert.ok(html.includes('id="conditions-empty"'));
		assert.ok(html.includes('class="conditions-actions"'));
		assert.ok(/id="conditions-add" class="sb-btn sb-btn-add"/.test(html), 'Add is the shared add action');
		assert.ok(
			/id="conditions-clear" class="sb-btn sb-btn-secondary sb-btn-danger"[^>]*disabled/.test(html),
			'Clear is a secondary action with a danger treatment and starts disabled'
		);
		assert.ok(html.includes('<span>Clear values</span>'), 'Clear is labelled by what it does');
		assert.ok(html.includes('role="status" aria-live="polite"'), 'the panel status is announced');

		const bodyAt = html.indexOf('id="sb-conditions-values-body"');
		const panelAt = html.indexOf('id="conditions-panel"');
		const contentAt = html.indexOf('id="content"');
		assert.ok(bodyAt >= 0 && panelAt > bodyAt && panelAt > contentAt, 'the panel lives in the sidebar section body');
		const treeAt = html.indexOf('id="tree"');
		assert.ok(treeAt > contentAt, 'the panel is not inside #tree');
		assert.ok(html.indexOf('id="ecuc-conditions"') > treeAt, 'the entries are data, not shell markup');
	});

	test('the shared buttons are styled and the header badge counts committed values', () => {
		const html = page();
		const style = styleOf(html);
		assert.ok(/\.sb-btn-primary\s*\{(?=[^}]*--vscode-button-background)(?=[^}]*--vscode-button-foreground)/.test(style));
		assert.ok(/\.sb-btn-secondary\s*\{(?=[^}]*--vscode-panel-border)/.test(style));
		assert.ok(/\.sb-btn-add\s*\{(?=[^}]*--vscode-textLink-foreground)/.test(style));
		assert.ok(/\.sb-btn-danger\s*\{(?=[^}]*--vscode-errorForeground)/.test(style));
		assert.ok(/\.sb-btn:disabled\s*\{[^}]*opacity/.test(style));
		assert.ok(/\.conditions-actions\s*\{[^}]*border-top/.test(style));
		assert.ok(/\.sb-section-badge\s*\{[^}]*--vscode-descriptionForeground/.test(style));
		assert.ok(/\.condition-state\s*\{[^}]*--vscode-descriptionForeground/.test(style));
		const stateCss = /\.condition-state \{[^}]*\}/.exec(style);
		assert.ok(stateCss && !/#[0-9a-fA-F]{3,8}\b/.test(stateCss[0]), 'the badge uses theme colours only');

		const empty = { hidden: true };
		const clear = { disabled: false };
		const badge = { textContent: '', hidden: true };
		let rows = [
			fakeRow({ name: 'A_SC', value: '', new: 'false' }),
			fakeRow({ name: 'B_SC', value: '', new: 'false' }),
		];
		const list = { querySelectorAll: () => rows };
		const chrome = compileWith<{ updateConditionsChrome(): void }>(
			html,
			['updateConditionsChrome'],
			['conditionsList', 'conditionsEmpty', 'conditionsClear', 'conditionsValuesBadge'],
			[list, empty, clear, badge]
		);
		chrome.updateConditionsChrome();
		assert.strictEqual(empty.hidden, true, 'rows hide the empty state');
		assert.strictEqual(clear.disabled, false, 'rows enable Clear values');
		assert.strictEqual(badge.textContent, '2 constants · 2 missing');
		assert.strictEqual(badge.hidden, false);

		rows = [fakeRow({ name: 'A_SC', value: '1', new: 'false' }), fakeRow({ name: 'B_SC', value: '', new: 'false' })];
		chrome.updateConditionsChrome();
		assert.strictEqual(badge.textContent, '2 constants · 1 missing', 'a committed value is no longer missing');

		rows = [fakeRow({ name: '', value: '', new: 'true', editing: 'true' })];
		chrome.updateConditionsChrome();
		assert.strictEqual(badge.hidden, true, 'an unsaved Add draft is not a committed constant');
		assert.strictEqual(clear.disabled, true, 'and cannot be cleared');
		assert.strictEqual(empty.hidden, true, 'the draft row still fills the list');

		rows = [];
		chrome.updateConditionsChrome();
		assert.strictEqual(empty.hidden, false, 'no rows show the empty state');
		assert.strictEqual(clear.disabled, true, 'no rows disable Clear values');
		assert.strictEqual(badge.hidden, true, 'no rows hide the constant count');
	});

	test('the unknown badge is visible only for an empty committed value outside edit mode', () => {
		const html = page();
		const state = { hidden: true };
		const row = fakeRow({ name: 'A_SC', value: '', editing: 'false' }, { '.condition-state': state });
		const update = evaluateFunction<(row: unknown) => void>(html, 'updateConditionRowState');
		update(row);
		assert.strictEqual(state.hidden, false, 'an empty committed value shows unknown');
		row.dataset.value = '1';
		update(row);
		assert.strictEqual(state.hidden, true, 'a committed value hides unknown');
		row.dataset.value = '  ';
		update(row);
		assert.strictEqual(state.hidden, false, 'a blank committed value is still unknown');
		row.dataset.value = '1';
		row.dataset.editing = 'true';
		update(row);
		assert.strictEqual(state.hidden, true, 'an edit draft never shows the badge');
		state.hidden = false;
		row.dataset.value = '';
		update(row);
		assert.strictEqual(state.hidden, true, 'editing wins over an empty committed value');

		const source = functionSource(html, 'updateConditionRowState');
		assert.ok(source.includes("state.hidden = editing || value !== ''"), 'the fixed predicate is in the page');
		assert.ok(!source.includes("=== ''"), 'the old inverted predicate is gone');
		assert.ok(!source.includes('.condition-value'), 'the draft input is never read');
	});

	test('the embedded entries are escaped and parsed back exactly', () => {
		const tricky: ConditionEntry[] = [
			{ name: 'A_SC', value: '</script><script>alert("x")</script>&' },
			{ name: 'B_SC', value: '1' },
		];
		const html = page(tricky);
		const match = /<script type="application\/json" id="ecuc-conditions"[^>]*>([\s\S]*?)<\/script>/.exec(html);
		assert.ok(match);
		assert.ok(!match[1].includes('</script'), 'the value cannot close the script');
		assert.ok(!match[1].includes('<script'), 'no raw angle brackets');
		assert.ok(!match[1].includes('&'), 'ampersands are escaped too');
		assert.ok(match[1].includes('\\u003c') && match[1].includes('\\u003e') && match[1].includes('\\u0026'));
		assert.deepStrictEqual(JSON.parse(match[1]), tricky);
		assert.deepStrictEqual(conditionPayload(page(tricky)), tricky);

		const encoded = encodeJsonForScript({ text: '</script>\u2028' });
		assert.ok(!encoded.includes('</script>'));
		assert.deepStrictEqual(JSON.parse(encoded), { text: '</script>\u2028' });
	});

	test('rows are built from committed datasets and expose the explicit actions', () => {
		const html = page([{ name: 'CANIPCORETYPE_SC', value: '1' }]);
		const create = functionSource(html, 'conditionRowElement');
		assert.ok(create.includes("row.className = 'condition-row parent'"));
		assert.ok(create.includes('row.dataset.name = name'));
		assert.ok(create.includes('row.dataset.value = value'));
		assert.ok(create.includes('row.dataset.auto ='));
		assert.ok(create.includes('row.dataset.editing ='));
		assert.ok(create.includes('row.dataset.new ='));
		assert.ok(create.includes('renderConditionRow(row)'));
		assert.ok(!create.includes('innerHTML'), 'entries are never markup');

		const render = functionSource(html, 'renderConditionRow');
		assert.ok(render.includes("nameText.className = 'condition-name-text'"), 'the name is text in view mode');
		assert.ok(render.includes("nameInput.className = 'condition-name'"), 'only a new row edits the name');
		assert.ok(render.includes("valueInput.className = 'condition-value'"));
		assert.ok(render.includes("valueText.className = 'condition-value-text'"));
		assert.ok(render.includes("state.className = 'condition-state'"));
		assert.ok(render.includes("state.textContent = 'unknown'"));
		assert.ok(render.includes('updateConditionRowState(row)'), 'the badge follows the committed value');
		assert.ok(render.includes("save.className = 'sb-btn sb-btn-primary condition-save'"));
		assert.ok(render.includes("cancel.className = 'sb-btn sb-btn-secondary condition-cancel'"));
		assert.ok(render.includes("'condition-edit'"), 'the pencil is a compact act-btn');
		assert.ok(render.includes("'condition-remove'"), 'the trash is a compact act-btn');
		assert.ok(render.includes('if (!auto)'), 'scanned rows get no Remove');
		assert.ok(!render.includes('innerHTML'));

		assert.ok(!functionSource(html, 'renderConditionEntries').includes('innerHTML'));
		assert.ok(functionSource(html, 'renderConditionEntries').includes('appendChild(conditionRowElement'));
		assert.ok(
			functionSource(html, 'renderConditionEntries').includes('ensureDiscoveredConditionRows()'),
			'a host entries refresh re-discovers the document constants'
		);
		const add = functionSource(html, 'addConditionEntry');
		assert.ok(add.includes('isNew: true'), 'Add opens an unsaved manual row');
		assert.ok(add.includes("editing: true"));
		assert.ok(add.includes('beginConditionEdit(row)'), 'the new row starts in edit mode');
		assert.ok(!add.includes('sendConditions'), 'Add sends nothing before Save');
		const remove = functionSource(html, 'removeConditionRow');
		assert.ok(remove.includes("row.dataset.auto === 'true'"), 'scanned rows are never removable');
		assert.ok(remove.includes('sendConditions()'));
		const clear = functionSource(html, 'clearConditionEntries');
		assert.ok(clear.includes('cancelConditionEdit(editingRow)'), 'Clear cancels the active draft');
		assert.ok(clear.includes('dataset.value = '), 'and empties every committed value');
		assert.ok(!clear.includes("conditionsList.textContent = ''"), 'without removing the rows');
		assert.ok(!html.includes('innerHTML'), 'the page has no innerHTML path at all');
	});

	test('readConditionEntries reads committed datasets and ignores a draft', () => {
		const html = page();
		const list = {
			querySelectorAll: () => [
				fakeRow({ name: '  A_SC  ', value: ' 1 ', new: 'false', auto: 'false' }),
				fakeRow({ name: 'BAD NAME', value: '2', new: 'false', auto: 'false' }),
				fakeRow({ name: '   ', value: '3', new: 'false', auto: 'false' }),
				fakeRow({ name: 'B_SC', value: '', new: 'false', auto: 'false' }),
				fakeRow({ name: 'C_SC', value: '', new: 'false', auto: 'true' }),
				fakeRow({ name: 'E_SC', value: '3', new: 'false', auto: 'true' }),
				fakeRow({ name: 'DRAFT_SC', value: '9', new: 'true', auto: 'false' }),
			],
		};
		const compiled = compileWith<{ readConditionEntries(): ConditionEntry[] }>(
			html,
			['conditionNameValid', 'readConditionEntries'],
			['conditionsList'],
			[list]
		);
		assert.deepStrictEqual(compiled.readConditionEntries(), [
			{ name: 'A_SC', value: ' 1 ' },
			{ name: 'B_SC', value: '' },
			{ name: 'E_SC', value: '3' },
		]);
		const source = functionSource(html, 'readConditionEntries');
		assert.ok(source.includes('row.dataset.value'), 'the committed value is the only value read');
		assert.ok(
			source.includes("row.dataset.auto === 'true' && value === ''"),
			'an empty discovered constant is not persisted as a manual row'
		);
		assert.ok(!source.includes('querySelector('), 'no input is queried');
		assert.ok(
			html.includes("event.target.tagName !== 'INPUT'"),
			'Enter on Save/Cancel is left to the button, not treated as a value commit'
		);
		const valid = evaluateFunction<(name: string) => boolean>(html, 'conditionNameValid');
		assert.strictEqual(valid('A_SC'), true);
		assert.strictEqual(valid('Pkg.Mod/Sub-1_A'), true);
		assert.strictEqual(valid('/Pkg/SwSystemconsts/A_SC'), true);
		assert.strictEqual(valid('1ABC'), false);
		assert.strictEqual(valid('A B'), false);
		for (const name of ['A_SC', 'Pkg.Mod/Sub-1_A', '/Pkg/SwSystemconsts/A_SC', '1ABC', 'A B']) {
			assert.strictEqual(valid(name), isConditionName(name), `the page and host agree on "${name}"`);
		}
	});

	test('a host entries refresh replaces the panel rows and leaves other messages alone', () => {
		const html = page();
		const appended: unknown[] = [];
		const list = {
			textContent: 'stale',
			appendChild: (item: unknown) => appended.push(item),
			querySelectorAll: () => appended,
		};
		const row = { name: 'A_SC' };
		const compiled = compileWith<{ applyConditionsMessage(message: unknown): boolean }>(
			html,
			['renderConditionEntries', 'applyConditionsMessage'],
			[
				'conditionsList',
				'editingRow',
				'conditionRowElement',
				'ensureDiscoveredConditionRows',
				'syncConditionRowAutoFlags',
				'updateConditionsChrome',
			],
			[list, undefined, () => row, () => {}, () => {}, () => {}]
		);
		assert.strictEqual(compiled.applyConditionsMessage({ type: 'model' }), false, 'other messages are not handled');
		assert.strictEqual(compiled.applyConditionsMessage({ type: 'conditions', entries: [{}] }), true);
		assert.strictEqual(list.textContent, '', 'the old rows are cleared');
		assert.deepStrictEqual(appended, [row], 'the host entries are rendered with the page builder');

		const draftList = { textContent: 'draft rows', appendChild: () => undefined, querySelectorAll: () => [] };
		const blocked = compileWith<{ renderConditionEntries(entries: unknown): void }>(
			html,
			['renderConditionEntries'],
			[
				'conditionsList',
				'editingRow',
				'conditionRowElement',
				'ensureDiscoveredConditionRows',
				'syncConditionRowAutoFlags',
				'updateConditionsChrome',
			],
			[draftList, { dataset: { new: 'false' } }, () => undefined, () => {}, () => {}, () => {}]
		);
		blocked.renderConditionEntries([]);
		assert.strictEqual(draftList.textContent, 'draft rows', 'a host push cannot replace a local draft');
	});

	test('discovery adds only missing symbols and sends no message', () => {
		const html = page();
		const appended: FakeRow[] = [];
		const existing: FakeRow[] = [fakeRow({ name: 'A_SC', value: '1', auto: 'true' })];
		const list = {
			querySelectorAll: (): FakeRow[] => existing.concat(appended),
			appendChild: (row: FakeRow) => appended.push(row),
		};
		const rows = [
			{ condition: { symbols: ['A_SC', 'B_SC'] } },
			{ condition: { symbols: ['B_SC', 'C_SC'] } },
			{ condition: {} },
			{},
		];
		const created: Array<{ name: string; value: string }> = [];
		const compiled = compileWith<{ ensureDiscoveredConditionRows(): void }>(
			html,
			['discoveredConditionSymbols', 'existingConditionNames', 'ensureDiscoveredConditionRows', 'syncConditionRowAutoFlags'],
			[
				'rows',
				'conditionsList',
				'conditionRowElement',
				'updateConditionsChrome',
				'renderConditionRow',
			],
			[
				rows,
				list,
				(entry: { name: string; value: string }): FakeRow => {
					created.push(entry);
					return fakeRow({ name: entry.name, value: entry.value, auto: 'true' });
				},
				() => {},
				() => {},
			]
		);
		compiled.ensureDiscoveredConditionRows();
		assert.deepStrictEqual(created, [
			{ name: 'B_SC', value: '' },
			{ name: 'C_SC', value: '' },
		]);
		assert.ok(
			!functionSource(html, 'ensureDiscoveredConditionRows').includes('postMessage'),
			'discovery changes no value and sends nothing'
		);
		assert.ok(
			!functionSource(html, 'ensureDiscoveredConditionRows').includes('dismiss'),
			'scanned rows need no dismissal set'
		);
	});

	test('a real document yields each discovered constant once, in document order', () => {
		const html = page();
		const discovered = (scanned: EcucRow[]): string[] =>
			compileWith<{ discoveredConditionSymbols(): string[] }>(
				html,
				['discoveredConditionSymbols'],
				['rows'],
				[scanned]
			).discoveredConditionSymbols();
		assert.deepStrictEqual(
			discovered(buildRows(model(), { sort: 'declaration' }).rows),
			['CANIPCORETYPE_SC', 'MISSING_SC', 'A'],
			'module, container, parameter and reference conditions all contribute; duplicates collapse and literals add nothing'
		);
		assert.deepStrictEqual(
			discovered(buildRows(model()).rows),
			['CANIPCORETYPE_SC', 'A', 'MISSING_SC'],
			'the page follows the row order the host sends'
		);
	});

	test('scanned rows have no Remove and a manual row that becomes scanned keeps its value', () => {
		const html = page();
		let aHasRemove = true;
		const removeButton = { focus: () => undefined };
		const a: FakeRow = {
			dataset: { name: 'A_SC', value: '1', auto: 'false', editing: 'false', new: 'false' },
			querySelector(selector: string) {
				return selector === '.condition-remove' && aHasRemove ? removeButton : null;
			},
		};
		const b: FakeRow = fakeRow({ name: 'B_SC', value: '2', auto: 'true', editing: 'false', new: 'false' });
		const list = { querySelectorAll: () => [a, b] };
		const documentRows = [{ condition: { symbols: ['A_SC'] } }];
		const rendered: FakeRow[] = [];
		const compiled = compileWith<{ syncConditionRowAutoFlags(): void }>(
			html,
			['discoveredConditionSymbols', 'syncConditionRowAutoFlags'],
			['rows', 'conditionsList', 'renderConditionRow'],
			[
				documentRows,
				list,
				(row: FakeRow) => {
					rendered.push(row);
					if (row === a) {
						aHasRemove = false;
					}
				},
			]
		);

		compiled.syncConditionRowAutoFlags();
		assert.strictEqual(a.dataset.auto, 'true', 'a referenced manual name becomes scanned');
		assert.strictEqual(a.dataset.value, '1', 'the value is preserved');
		assert.strictEqual(b.dataset.auto, 'false', 'an unreferenced name becomes manual');
		assert.ok(rendered.includes(a), 'the manual row is rebuilt without Remove');
		assert.ok(rendered.includes(b), 'the scanned row is rebuilt with Remove');

		aHasRemove = false;
		documentRows[0].condition.symbols = [];
		rendered.length = 0;
		compiled.syncConditionRowAutoFlags();
		assert.strictEqual(a.dataset.auto, 'false', 'a name that leaves the document becomes manual again');
		assert.strictEqual(a.dataset.value, '1', 'the value survives every re-scan');
		assert.ok(rendered.includes(a), 'and Remove returns');
	});

	test('Remove sends one message for a manual row and ignores a scanned row', () => {
		const html = page();
		let removed = 0;
		let sent = 0;
		const compiled = compileWith<{ removeConditionRow(row: unknown): void }>(
			html,
			['removeConditionRow'],
			['editingRow', 'conditionsStatus', 'updateConditionsChrome', 'sendConditions'],
			[undefined, null, () => {}, () => { sent++; }]
		);
		const manual = {
			dataset: { name: 'A_SC', value: '1', auto: 'false', new: 'false' },
			parentNode: { removeChild: () => { removed++; } },
		};
		compiled.removeConditionRow(manual);
		assert.strictEqual(removed, 1, 'the manual row is removed from the panel');
		assert.strictEqual(sent, 1, 'and the host is told once');
		const scanned = {
			dataset: { name: 'B_SC', value: '1', auto: 'true', new: 'false' },
			parentNode: { removeChild: () => { removed++; } },
		};
		compiled.removeConditionRow(scanned);
		assert.strictEqual(removed, 1, 'a scanned row is never removed');
		assert.strictEqual(sent, 1, 'and no message is sent for it');
	});

	test('a model re-push runs discovery after the new row store is indexed', () => {
		const html = page();
		const setRows = functionSource(html, 'setRows');
		const indexAt = setRows.indexOf('indexRows()');
		const discoverAt = setRows.indexOf('ensureDiscoveredConditionRows()');
		assert.ok(indexAt >= 0, 'setRows rebuilds the row index');
		assert.ok(discoverAt > indexAt, 'a document change discovers from the new rows');
	});

	test('Clear values cancels the active draft, empties committed values, keeps rows and sends once', () => {
		const html = page();
		let cancelled = 0;
		const rows = [fakeRow({ name: 'A_SC', value: '1', new: 'false' }), fakeRow({ name: 'B_SC', value: '2', new: 'false' })];
		const list = { textContent: 'rows', querySelectorAll: () => rows };
		const rendered: unknown[] = [];
		let sent = 0;
		const compiled = compileWith<{ clearConditionEntries(): void }>(
			html,
			['clearConditionEntries'],
			[
				'editingRow',
				'cancelConditionEdit',
				'conditionsList',
				'renderConditionRow',
				'updateConditionsChrome',
				'sendConditions',
			],
			[
				{ dataset: { new: 'false' } },
				() => { cancelled++; },
				list,
				(row: unknown) => rendered.push(row),
				() => {},
				() => { sent++; },
			]
		);
		compiled.clearConditionEntries();
		assert.strictEqual(cancelled, 1, 'the open draft is cancelled first');
		assert.deepStrictEqual(rows.map((row) => row.dataset.value), ['', ''], 'every committed value is emptied');
		assert.strictEqual(rendered.length, 2, 'each row is rebuilt so the badge returns');
		assert.strictEqual(list.textContent, 'rows', 'the rows stay in place');
		assert.strictEqual(sent, 1, 'one message carries the empty values');
	});

	test('starting Edit on another row cancels the first draft and restores its value', () => {
		const html = page();
		const rendered: FakeRow[] = [];
		const a = fakeRow(
			{ name: 'A_SC', value: '1', editing: 'false', auto: 'true', new: 'false' },
			{ '.condition-value': fakeInput('draft') }
		);
		const b = fakeRow(
			{ name: 'B_SC', value: '2', editing: 'false', auto: 'true', new: 'false' },
			{ '.condition-value': fakeInput('') }
		);
		const compiled = compileWith<{ beginConditionEdit(row: unknown): void }>(
			html,
			['beginConditionEdit', 'cancelConditionEdit', 'focusConditionEditor'],
			['editingRow', 'renderConditionRow', 'conditionsStatus', 'updateConditionsChrome'],
			[undefined, (row: FakeRow) => rendered.push(row), null, () => {}]
		);
		compiled.beginConditionEdit(a);
		assert.strictEqual(a.dataset.editing, 'true', 'the clicked row edits');
		compiled.beginConditionEdit(b);
		assert.strictEqual(a.dataset.editing, 'false', 'the previous draft is cancelled');
		assert.strictEqual(a.dataset.value, '1', 'the committed value is untouched');
		assert.ok(rendered.includes(a), 'the previous row is rebuilt from its committed value');
		assert.strictEqual(b.dataset.editing, 'true', 'the second row edits');
	});

	test('Save commits the draft, sends exactly one message and updates the row', () => {
		const html = page();
		const valueInput = fakeInput('1');
		const row = fakeRow(
			{ name: 'CANIPCORETYPE_SC', value: '', editing: 'true', auto: 'true', new: 'false' },
			{ '.condition-value': valueInput }
		);
		const list = { querySelectorAll: () => [row] };
		const messages: unknown[] = [];
		let updates = 0;
		const compiled = compileWith<{ saveConditionEdit(row: unknown): void }>(
			html,
			[
				'conditionNameValid',
				'readConditionEntries',
				'sendConditions',
				'conditionEntryError',
				'conditionOtherNames',
				'saveConditionEdit',
			],
			[
				'conditionsList',
				'editingRow',
				'renderConditionRow',
				'syncConditionRowAutoFlags',
				'updateConditionsChrome',
				'conditionsStatus',
				'vscode',
			],
			[
				list,
				undefined,
				() => {},
				() => {},
				() => { updates++; },
				null,
				{ postMessage: (message: unknown) => messages.push(message) },
			]
		);
		compiled.saveConditionEdit(row);
		assert.strictEqual(row.dataset.value, '1', 'the draft is committed');
		assert.strictEqual(row.dataset.editing, 'false', 'the row returns to view mode');
		assert.strictEqual(updates, 1, 'the badge and counts are refreshed');
		assert.deepStrictEqual(
			messages,
			[{ type: 'conditions', entries: [{ name: 'CANIPCORETYPE_SC', value: '1' }] }],
			'exactly one message carries the committed entries'
		);

		row.dataset.value = '1';
		row.dataset.editing = 'true';
		valueInput.value = '';
		compiled.saveConditionEdit(row);
		assert.strictEqual(row.dataset.value, '', 'an empty Save is committed and makes the row unknown again');
		assert.strictEqual(messages.length, 2, 'one more message, not a message per keystroke');

		assert.ok(!html.includes('scheduleConditions'), 'the debounced typing path is gone');
		assert.ok(!html.includes('conditionDebouncer'), 'and its timer is gone');
		assert.ok(!html.includes('createFilterDebouncer(300)'));
		assert.strictEqual(
			(html.match(/sendConditions\(\);/g) || []).length,
			3,
			'only Save, Remove and Clear send; typing a draft posts nothing'
		);
	});

	test('Cancel restores the committed value, sends nothing and removes an unsaved draft', () => {
		const html = page();
		let sent = 0;
		const row = fakeRow(
			{ name: 'A_SC', value: '1', editing: 'true', auto: 'true', new: 'false' },
			{ '.condition-value': fakeInput('draft') }
		);
		const compiled = compileWith<{ cancelConditionEdit(row: unknown): void }>(
			html,
			['cancelConditionEdit'],
			['editingRow', 'renderConditionRow', 'conditionsStatus', 'updateConditionsChrome', 'sendConditions'],
			[row, () => {}, null, () => {}, () => { sent++; }]
		);
		compiled.cancelConditionEdit(row);
		assert.strictEqual(row.dataset.value, '1', 'the committed value is untouched');
		assert.strictEqual(row.dataset.editing, 'false', 'the row returns to view mode');
		assert.strictEqual(sent, 0, 'Cancel sends nothing');

		let removed = 0;
		const draft = {
			dataset: { name: '', value: '', new: 'true', editing: 'true' },
			parentNode: { removeChild: () => { removed++; } },
		};
		const compiledDraft = compileWith<{ cancelConditionEdit(row: unknown): void }>(
			html,
			['cancelConditionEdit'],
			['editingRow', 'renderConditionRow', 'conditionsStatus', 'updateConditionsChrome', 'sendConditions'],
			[draft, () => {}, null, () => {}, () => { sent++; }]
		);
		compiledDraft.cancelConditionEdit(draft);
		assert.strictEqual(removed, 1, 'an unsaved Add draft is removed');
		assert.strictEqual(sent, 0, 'and still nothing is sent');
	});

	test('Add opens a manual draft; Save validates the name and Cancel removes it', () => {
		const html = page();
		const created: Array<Record<string, unknown>> = [];
		let begun: unknown;
		const list = { appendChild: () => undefined };
		const add = compileWith<{ addConditionEntry(): void }>(
			html,
			['addConditionEntry'],
			[
				'editingRow',
				'conditionsList',
				'conditionRowElement',
				'conditionsStatus',
				'beginConditionEdit',
				'updateConditionsChrome',
			],
			[
				undefined,
				list,
				(entry: unknown, options: Record<string, unknown>) => {
					created.push(options);
					return { dataset: {} };
				},
				null,
				(row: unknown) => { begun = row; },
				() => {},
			]
		);
		add.addConditionEntry();
		assert.deepStrictEqual(created[0], { auto: false, isNew: true, editing: true }, 'a new manual row starts editing');
		assert.ok(begun, 'the new row begins edit mode');
		assert.ok(!functionSource(html, 'addConditionEntry').includes('sendConditions'), 'Add does not send');

		const nameInput = fakeInput('');
		const valueInput = fakeInput('1');
		const row = fakeRow(
			{ name: '', value: '', editing: 'true', new: 'true', auto: 'false' },
			{ '.condition-name': nameInput, '.condition-value': valueInput }
		);
		const other = fakeRow({ name: 'A_SC', value: '', new: 'false' });
		let rows = [row];
		const rowsList = { querySelectorAll: () => rows };
		const status = { textContent: '' };
		let sent = 0;
		const save = compileWith<{ saveConditionEdit(row: unknown): void }>(
			html,
			['conditionNameValid', 'conditionEntryError', 'conditionOtherNames', 'saveConditionEdit'],
			[
				'conditionsList',
				'editingRow',
				'renderConditionRow',
				'syncConditionRowAutoFlags',
				'updateConditionsChrome',
				'sendConditions',
				'conditionsStatus',
			],
			[rowsList, row, () => {}, () => {}, () => {}, () => { sent++; }, status]
		);
		save.saveConditionEdit(row);
		assert.strictEqual(status.textContent, 'Enter a constant name before saving.');
		assert.strictEqual(row.dataset.editing, 'true', 'a blank name keeps edit mode');
		assert.strictEqual(sent, 0);

		nameInput.value = 'BAD NAME';
		save.saveConditionEdit(row);
		assert.ok(status.textContent.startsWith('Invalid name:'), status.textContent);
		assert.strictEqual(sent, 0);

		rows = [row, other];
		nameInput.value = 'A_SC';
		save.saveConditionEdit(row);
		assert.ok(status.textContent.includes('already exists'), status.textContent);
		assert.strictEqual(sent, 0);

		rows = [row];
		nameInput.value = 'NEW_SC';
		save.saveConditionEdit(row);
		assert.strictEqual(row.dataset.name, 'NEW_SC');
		assert.strictEqual(row.dataset.new, 'false');
		assert.strictEqual(row.dataset.value, '1');
		assert.strictEqual(sent, 1, 'a valid Add Save sends one message');
		assert.strictEqual(status.textContent, '');
	});

	test('applyDisabledCount reports the live number of disabled rows', () => {
		const html = page();
		const count = { textContent: '', hidden: false };
		const compiled = compileWith<{ applyDisabledCount(): void }>(
			html,
			['applyDisabledCount'],
			['rows', 'conditionsCount'],
			[[{ disabled: true }, {}, { disabled: true }], count]
		);
		compiled.applyDisabledCount();
		assert.strictEqual(count.textContent, '2 disabled');
		assert.strictEqual(count.hidden, false);

		const none = { textContent: 'stale', hidden: false };
		compileWith<{ applyDisabledCount(): void }>(
			html,
			['applyDisabledCount'],
			['rows', 'conditionsCount'],
			[[{}, {}], none]
		).applyDisabledCount();
		assert.strictEqual(none.textContent, '');
		assert.strictEqual(none.hidden, true);
	});

	test('buildNodeRow and metaSpan expose the disabled state and the chip state', () => {
		const html = page();
		const build = functionSource(html, 'buildNodeRow');
		assert.ok(build.includes("node.dataset.disabled = 'true'"));
		assert.ok(build.includes("suffix.className = 'sr-only'"));
		assert.ok(build.includes("suffix.textContent = '(disabled by condition)'"));
		assert.ok(build.indexOf('metaSpan(row)') < build.indexOf("suffix.className = 'sr-only'"), 'the suffix follows the meta');

		const meta = functionSource(html, 'metaSpan');
		assert.ok(meta.includes('if (part.state)'));
		assert.ok(meta.includes('span.dataset.state = part.state'));

		const style = styleOf(html);
		assert.ok(/\.node\[data-disabled="true"\] > \.row\s*\{[^}]*opacity:\s*0\.55[^}]*--vscode-disabledForeground/.test(style));
		assert.ok(/\.condition\[data-state="false"\]\s*\{[^}]*--vscode-errorForeground/.test(style));
		assert.ok(!/\.condition\[data-state="unknown"\]/.test(style), 'unknown keeps the existing appearance (PRD R12)');
		assert.ok(/\.sr-only\s*\{[^}]*clip:\s*rect\(0, 0, 0, 0\)/.test(style));
		assert.ok(/\.condition-name\[aria-invalid="true"\]/.test(style));
		for (const selector of ['.conditions-panel', '.condition-row', '.conditions-hint', '.condition-name-text', '.condition-value-text', '.condition-save', '.condition-cancel']) {
			assert.ok(style.includes(selector), selector);
		}
		assert.ok(
			/\.condition-name,\s*\.condition-value\s*\{[^}]*--vscode-input-background[^}]*--vscode-input-border/.test(style),
			'inputs use the theme input colours'
		);
		const panelCss = /\.conditions-panel \{[\s\S]*?\n\}/.exec(style);
		assert.ok(panelCss && !/#[0-9a-fA-F]{3,8}\b/.test(panelCss[0]), 'no new colour literal');
	});

	test('the inspector shows the condition, state, reason and inherited note', () => {
		const html = page();
		const rows = buildRows(model()).rows;
		const selfOff = rows.find((row) => row.label === 'SelfOff')!;
		const fields = inspectorFields(selfOff);
		assert.strictEqual(fields.condition?.text, '(CANIPCORETYPE_SC==0)');
		assert.strictEqual(fields.condition?.state, 'unknown');
		assert.deepStrictEqual(fields.conditions, '', 'the own syscond is not repeated in the post-build row');

		const update = functionSource(html, 'updateInspector');
		for (const label of ['Condition', 'Condition state', 'Condition note', 'Disabled by an ancestor condition.']) {
			assert.ok(update.includes(`'${label}'`), label);
		}
		assert.ok(update.includes('data.condition.reason'));
		assert.ok(update.includes("row.disabledBy === 'ancestor'"));
		assert.ok(!update.includes('innerHTML'), 'the panel is built from text nodes');
	});
});

suite('conditions provider wiring (design §5)', () => {
	interface StubMessage {
		type?: string;
		message?: string;
		kind?: string;
		entries?: unknown;
		rows?: Array<{ label: string; disabled?: boolean }>;
	}

	function stubPanel(): {
		panel: vscode.WebviewPanel;
		messages: StubMessage[];
		send(message: unknown): void;
		dispose(): void;
	} {
		const messages: StubMessage[] = [];
		let listener: ((message: unknown) => void) | undefined;
		const disposeListeners: Array<() => void> = [];
		const webview = {
			options: {},
			html: '',
			onDidReceiveMessage: (next: (message: unknown) => void) => {
				listener = next;
				return new vscode.Disposable(() => undefined);
			},
			postMessage: (message: unknown) => {
				messages.push(message as StubMessage);
				return Promise.resolve(true);
			},
		};
		const panel = {
			webview,
			reveal: () => undefined,
			onDidDispose: (callback: () => void) => {
				disposeListeners.push(callback);
				return new vscode.Disposable(() => undefined);
			},
		} as unknown as vscode.WebviewPanel;
		return {
			panel,
			messages,
			send: (message: unknown) => listener?.(message),
			dispose: () => disposeListeners.forEach((callback) => callback()),
		};
	}

	test('a conditions message re-pushes one panel and never reloads another', async () => {
		const provider = new EcucEditorProvider();
		const firstDocument = await vscode.workspace.openTextDocument(fixtureUri(FIXTURE));
		const secondDocument = await vscode.workspace.openTextDocument(fixtureUri('editor/render.arxml'));
		const token = new vscode.CancellationTokenSource().token;
		const first = stubPanel();
		const second = stubPanel();
		provider.resolveCustomTextEditor(firstDocument, first.panel, token);
		provider.resolveCustomTextEditor(secondDocument, second.panel, token);
		try {
			const secondHtml = second.panel.webview.html;
			first.send({ type: 'conditions', entries: [{ name: 'CANIPCORETYPE_SC', value: '1' }] });
			assert.ok(first.messages.some((message) => message.type === 'model'), 'the sending panel re-renders');
			assert.strictEqual(second.panel.webview.html, secondHtml, 'the other panel is not reloaded');
			assert.strictEqual(
				second.messages.filter((message) => message.type === 'model').length,
				0,
				'a condition change does not push rows into another panel'
			);
		} finally {
			first.dispose();
			second.dispose();
		}
	});

	test('a reloaded page is re-sent the current entries, not the first-paint copy', async () => {
		const store = {
			load: (): ConditionEntry[] => [{ name: 'A_SC', value: '1' }],
			save: (): Thenable<void> => Promise.resolve(),
		} as unknown as ConditionValueStore;
		const provider = new EcucEditorProvider(store);
		const document = await vscode.workspace.openTextDocument(fixtureUri(FIXTURE));
		const stub = stubPanel();
		provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);
		try {
			stub.send({ type: 'conditions', entries: [{ name: 'A_SC', value: '2' }] });
			stub.send({ type: 'ready' });
			const refreshed = stub.messages.filter((message) => message.type === 'conditions').at(-1);
			assert.ok(refreshed, 'the host answered the reload');
			assert.deepStrictEqual(refreshed!.entries, [{ name: 'A_SC', value: '2' }]);
		} finally {
			stub.dispose();
		}
	});

	test('loads stored values, re-renders on a conditions message and saves normalized entries', async () => {
		const saved: ConditionEntry[][] = [];
		const store = {
			load: (): ConditionEntry[] => [{ name: 'CANIPCORETYPE_SC', value: '1' }],
			save: (entries: readonly ConditionEntry[]): Thenable<void> => {
				saved.push(entries.map((entry) => ({ ...entry })));
				return Promise.resolve();
			},
		} as unknown as ConditionValueStore;
		const provider = new EcucEditorProvider(store);
		const document = await vscode.workspace.openTextDocument(fixtureUri(FIXTURE));
		const stub = stubPanel();
		provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);
		try {
			assert.deepStrictEqual(conditionPayload(stub.panel.webview.html), [
				{ name: 'CANIPCORETYPE_SC', value: '1' },
			]);
			assert.strictEqual(
				rowPayload(stub.panel.webview.html).find((row) => row.label === 'SelfOff')?.disabled,
				true,
				'the initial render uses the loaded condition map'
			);
			const initialRows = buildRows(scanEcucValues(document.getText()), {
				conditions: new Map([['CANIPCORETYPE_SC', 1]]),
			}).rows;
			assert.strictEqual(initialRows.find((row) => row.label === 'SelfOff')?.disabled, true, 'the loaded value applies');

			stub.send({
				type: 'conditions',
				entries: [
					{ name: 'CANIPCORETYPE_SC', value: '0' },
					{ name: 'BAD NAME', value: '1' },
				],
			});
			assert.deepStrictEqual(saved, [[{ name: 'CANIPCORETYPE_SC', value: '0' }]], 'normalized before saving');
			const notice = stub.messages.find((message) => message.type === 'notice');
			assert.ok(notice, 'an invalid name is reported');
			assert.strictEqual(notice!.kind, 'warn');
			assert.ok(notice!.message!.includes('BAD NAME'), notice!.message);

			const pushed = stub.messages.filter((message) => message.type === 'model').at(-1);
			assert.ok(pushed?.rows, 'the rows are pushed without reloading the page');
			assert.notStrictEqual(pushed!.rows!.find((row) => row.label === 'SelfOff')?.disabled, true);
			assert.strictEqual(
				pushed!.rows!.find((row) => row.label === 'ContB')?.disabled,
				false,
				'CANIPCORETYPE_SC=0 makes the container condition true'
			);

			const messageCount = stub.messages.length;
			stub.send({ type: 'conditions', entries: 'not an array' });
			assert.strictEqual(stub.messages.length, messageCount, 'a non-array payload is ignored');
			assert.strictEqual(saved.length, 1, 'and nothing is saved');
		} finally {
			stub.dispose();
		}
	});
});
