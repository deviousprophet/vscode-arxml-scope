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

interface FakeConditionRow {
	querySelector(selector: string): FakeInput | null;
}

function fakeConditionRow(name: string | null, value: string | null): FakeConditionRow {
	const nameInput = name === null ? null : fakeInput(name);
	const valueInput = value === null ? null : fakeInput(value);
	return {
		querySelector(selector: string) {
			return selector === '.condition-name' ? nameInput : selector === '.condition-value' ? valueInput : null;
		},
	};
}

suite('conditions panel (design §6)', () => {
	test('the toolbar toggle and the panel shell exist once, outside #tree', () => {
		const html = page();
		assert.ok(/id="conditions-toggle"[^>]*aria-pressed="false"[^>]*aria-expanded="false"[^>]*aria-controls="conditions-panel"/.test(html));
		assert.ok(html.includes('title="Enter SW system-constant values"'));
		assert.ok(html.includes('<span class="lbl">Conditions</span>'));

		assert.ok(html.includes('<div id="conditions-panel" class="conditions-panel" hidden>'));
		assert.ok(html.includes('id="conditions-list"'));
		assert.ok(html.includes('id="conditions-add"'));
		assert.ok(html.includes('id="conditions-clear"'));
		assert.ok(html.includes('id="conditions-count"'));
		assert.ok(html.includes('id="conditions-values-count"'));
		assert.ok(html.includes('id="conditions-empty"'));
		assert.ok(html.includes('class="conditions-actions"'));
		assert.ok(/id="conditions-add" class="tool primary"/.test(html), 'Add is a primary action');
		assert.ok(/id="conditions-clear" class="tool secondary danger"[^>]*disabled/.test(html), 'Clear starts disabled and is visibly a secondary action');
		assert.ok(html.includes('<span>Clear values</span>'), 'Clear is labelled by what it does');
		assert.ok(html.includes('role="status" aria-live="polite"'), 'the panel status is announced');

		const noticeAt = html.indexOf('id="notice"');
		const panelAt = html.indexOf('id="conditions-panel"');
		const contentAt = html.indexOf('id="content"');
		assert.ok(noticeAt >= 0 && panelAt > noticeAt && contentAt > panelAt, 'the panel survives a re-scan');
		const treeAt = html.indexOf('id="tree"');
		assert.ok(treeAt > contentAt, 'the panel is not inside #tree');
		assert.ok(html.indexOf('id="ecuc-conditions"') > treeAt, 'the entries are data, not shell markup');
	});

	test('the actions are visibly styled and the header tracks rows and missing values', () => {
		const html = page();
		const style = styleOf(html);
		assert.ok(/\.tool\.primary\s*\{(?=[^}]*--vscode-button-background)(?=[^}]*--vscode-button-foreground)/.test(style));
		assert.ok(/\.tool\.secondary\s*\{(?=[^}]*--vscode-button-secondaryBackground)(?=[^}]*--vscode-button-border)/.test(style));
		assert.ok(/\.tool\[disabled\]\s*\{[^}]*opacity/.test(style));
		assert.ok(/\.conditions-actions\s*\{[^}]*border-top/.test(style));
		assert.ok(/\.condition-state\s*\{[^}]*--vscode-descriptionForeground/.test(style));
		const stateCss = /\.condition-state \{[^}]*\}/.exec(style);
		assert.ok(stateCss && !/#[0-9a-fA-F]{3,8}\b/.test(stateCss[0]), 'the badge uses theme colours only');

		const empty = { hidden: true };
		const clear = { disabled: false };
		const values = { textContent: '', hidden: true };
		const row = (value: string) => ({
			querySelector(selector: string) {
				return selector === '.condition-value' ? { value } : null;
			},
		});
		let rows = [row(''), row('')];
		const list = { querySelectorAll: () => rows };
		const chrome = compileWith<{ updateConditionsChrome(): void }>(
			html,
			['updateConditionsChrome'],
			['conditionsList', 'conditionsEmpty', 'conditionsClear', 'conditionsValuesCount'],
			[list, empty, clear, values]
		);
		chrome.updateConditionsChrome();
		assert.strictEqual(empty.hidden, true, 'rows hide the empty state');
		assert.strictEqual(clear.disabled, false, 'rows enable Clear values');
		assert.strictEqual(values.textContent, '2 constants · 2 missing');
		assert.strictEqual(values.hidden, false);

		rows = [row('1'), row('')];
		chrome.updateConditionsChrome();
		assert.strictEqual(values.textContent, '2 constants · 1 missing', 'a typed value is no longer missing');

		list.querySelectorAll = () => [];
		chrome.updateConditionsChrome();
		assert.strictEqual(empty.hidden, false, 'no rows show the empty state');
		assert.strictEqual(clear.disabled, true, 'no rows disable Clear values');
		assert.strictEqual(values.hidden, true, 'no rows hide the constant count');
	});

	test('the unknown badge tracks whether a row has a value', () => {
		const html = page();
		const state = { hidden: true };
		const value = { value: '' };
		const row = {
			querySelector(selector: string) {
				return selector === '.condition-value' ? value : selector === '.condition-state' ? state : null;
			},
		};
		const update = evaluateFunction<(row: unknown) => void>(html, 'updateConditionRowState');
		update(row);
		assert.strictEqual(state.hidden, true, 'an empty value shows unknown');
		value.value = '1';
		update(row);
		assert.strictEqual(state.hidden, false, 'a typed value hides unknown');
		value.value = '  ';
		update(row);
		assert.strictEqual(state.hidden, true, 'a blank value is still unknown');
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

	test('the page renders, adds, removes, clears and reads entries with DOM values only', () => {
		const html = page([{ name: 'CANIPCORETYPE_SC', value: '1' }]);
		const create = functionSource(html, 'conditionRowElement');
		assert.ok(create.includes("document.createElement('input')"), 'real inputs');
		assert.ok(create.includes('name.value ='), 'the name is a value');
		assert.ok(create.includes('value.value ='), 'the value is a value');
		assert.ok(create.includes("name.className = 'condition-name'"));
		assert.ok(create.includes("value.className = 'condition-value'"));
		assert.ok(create.includes("remove.className = 'tool condition-remove'"));
		assert.ok(create.includes("state.className = 'condition-state'"));
		assert.ok(create.includes("state.textContent = 'unknown'"));
		assert.ok(create.includes("state.hidden = value.value.trim() === ''"), 'a stored empty value starts unknown');
		assert.ok(!create.includes('innerHTML'), 'entries are never markup');
		assert.ok(!functionSource(html, 'renderConditionEntries').includes('innerHTML'));
		assert.ok(functionSource(html, 'renderConditionEntries').includes('appendChild(conditionRowElement'));
		assert.ok(functionSource(html, 'renderConditionEntries').includes('updateConditionsChrome()'), 'the shell tracks the rows');
		assert.ok(
			functionSource(html, 'renderConditionEntries').includes('ensureDiscoveredConditionRows()'),
			'a host entries refresh re-discovers the document constants'
		);
		assert.ok(functionSource(html, 'addConditionEntry').includes('nameInput.focus()'), 'Add focuses the name');
		assert.ok(functionSource(html, 'addConditionEntry').includes('updateConditionsChrome()'));
		assert.ok(functionSource(html, 'removeConditionRow').includes('updateConditionsChrome()'));
		const clear = functionSource(html, 'clearConditionEntries');
		assert.ok(clear.includes(".condition-value"), 'Clear values targets the value inputs');
		assert.ok(clear.includes("value.value = ''"), 'and empties them');
		assert.ok(!clear.includes("conditionsList.textContent = ''"), 'without removing the rows');
		assert.ok(clear.includes('updateConditionsChrome()'));
		assert.ok(!html.includes('innerHTML'), 'the page has no innerHTML path at all');
	});

	test('readConditionEntries trims names, drops invalid/blank rows and keeps raw values', () => {
		const html = page();
		const list = {
			querySelectorAll: () => [
				fakeConditionRow('  A_SC  ', ' 1 '),
				fakeConditionRow('BAD NAME', '2'),
				fakeConditionRow('   ', '3'),
				fakeConditionRow('B_SC', ''),
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
		]);
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
			['conditionsList', 'conditionRowElement', 'updateConditionsChrome', 'ensureDiscoveredConditionRows'],
			[list, () => row, () => {}, () => {}]
		);
		assert.strictEqual(compiled.applyConditionsMessage({ type: 'model' }), false, 'other messages are not handled');
		assert.strictEqual(compiled.applyConditionsMessage({ type: 'conditions', entries: [{}] }), true);
		assert.strictEqual(list.textContent, '', 'the old rows are cleared');
		assert.deepStrictEqual(appended, [row], 'the host entries are rendered with the page builder');
	});

	test('discovery adds only missing symbols and sends no message', () => {
		const html = page();
		interface FakeRow {
			querySelector(selector: string): { value: string } | null;
		}
		const appended: FakeRow[] = [];
		const existing: FakeRow[] = [
			{ querySelector: (selector: string) => (selector === '.condition-name' ? { value: 'A_SC' } : null) },
		];
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
		const discovery = { signature: undefined, dismissed: new Set<string>() };
		const compiled = compileWith<{ ensureDiscoveredConditionRows(): void }>(
			html,
			['discoveredConditionSymbols', 'existingConditionNames', 'ensureDiscoveredConditionRows'],
			[
				'rows',
				'conditionsList',
				'conditionRowElement',
				'updateConditionsChrome',
				'updateConditionRowStates',
				'conditionDiscovery',
			],
			[
				rows,
				list,
				(entry: { name: string; value: string }): FakeRow => {
					created.push(entry);
					return { querySelector: () => null };
				},
				() => {},
				() => {},
				discovery,
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

	test('a removed discovered row survives a value re-push and returns only on a condition change', () => {
		const html = page();
		interface FakeRow {
			querySelector(selector: string): { value: string } | null;
		}
		const appended: FakeRow[] = [];
		const list = {
			querySelectorAll: (): FakeRow[] => appended,
			appendChild: (row: FakeRow) => appended.push(row),
		};
		const rows = [{ condition: { symbols: ['A_SC', 'B_SC'] } }];
		const created: string[] = [];
		const discovery = {
			signature: JSON.stringify(['A_SC', 'B_SC']),
			dismissed: new Set<string>(['A_SC']),
		};
		const compiled = compileWith<{ ensureDiscoveredConditionRows(): void }>(
			html,
			['discoveredConditionSymbols', 'existingConditionNames', 'ensureDiscoveredConditionRows'],
			[
				'rows',
				'conditionsList',
				'conditionRowElement',
				'updateConditionsChrome',
				'updateConditionRowStates',
				'conditionDiscovery',
			],
			[
				rows,
				list,
				(entry: { name: string }): FakeRow => {
					created.push(entry.name);
					return {
						querySelector: (selector: string) => (selector === '.condition-name' ? { value: entry.name } : null),
					};
				},
				() => {},
				() => {},
				discovery,
			]
		);
		compiled.ensureDiscoveredConditionRows();
		assert.deepStrictEqual(created, ['B_SC'], 'the dismissed constant is not re-added by a model re-push');

		created.length = 0;
		rows[0] = { condition: { symbols: ['A_SC', 'B_SC', 'C_SC'] } };
		compiled.ensureDiscoveredConditionRows();
		assert.deepStrictEqual(created, ['A_SC', 'C_SC'], 'a changed condition list clears the dismissal');
	});

	test('removing a row dismisses its constant and still removes it immediately', () => {
		const html = page();
		const discovery = { signature: '[]', dismissed: new Set<string>() };
		let removed = 0;
		const row = {
			parentNode: { removeChild: () => { removed++; } },
			querySelector: (selector: string) => (selector === '.condition-name' ? { value: ' A_SC ' } : null),
		};
		const compiled = compileWith<{ removeConditionRow(row: unknown): void }>(
			html,
			['removeConditionRow'],
			['conditionDiscovery', 'updateConditionsChrome', 'sendConditions'],
			[discovery, () => {}, () => {}]
		);
		compiled.removeConditionRow(row);
		assert.ok(discovery.dismissed.has('A_SC'), 'the removed constant is remembered');
		assert.strictEqual(removed, 1, 'the row is removed from the panel');
	});

	test('a model re-push runs discovery after the new row store is indexed', () => {
		const html = page();
		const setRows = functionSource(html, 'setRows');
		const indexAt = setRows.indexOf('indexRows()');
		const discoverAt = setRows.indexOf('ensureDiscoveredConditionRows()');
		assert.ok(indexAt >= 0, 'setRows rebuilds the row index');
		assert.ok(discoverAt > indexAt, 'a document change discovers from the new rows');
	});

	test('Clear values empties the rows without removing them', () => {
		const html = page();
		const value = { value: '1' };
		const state = { hidden: false };
		const row = {
			querySelector: (selector: string) =>
				selector === '.condition-value' ? value : selector === '.condition-state' ? state : null,
		};
		const list = { textContent: 'rows', querySelectorAll: () => [row] };
		let sent = 0;
		const compiled = compileWith<{ clearConditionEntries(): void }>(
			html,
			['updateConditionRowState', 'clearConditionEntries'],
			['conditionsList', 'updateConditionsChrome', 'sendConditions'],
			[list, () => {}, () => { sent++; }]
		);
		compiled.clearConditionEntries();
		assert.strictEqual(value.value, '', 'the value is emptied');
		assert.strictEqual(state.hidden, true, 'the unknown badge returns');
		assert.strictEqual(list.textContent, 'rows', 'the rows stay in place');
		assert.strictEqual(sent, 1, 'the empty values are sent to the host');
	});

	test('typing is debounced and the message carries only the raw entries', () => {
		const html = page();
		assert.ok(html.includes('createFilterDebouncer(300)'), 'the condition panel reuses the debouncer');

		const messages: unknown[] = [];
		const scheduled: Array<{ text: string; run: (text: string) => void }> = [];
		const list = { querySelectorAll: () => [fakeConditionRow('CANIPCORETYPE_SC', ' 1 ')] };
		const compiled = compileWith<{ scheduleConditions(): void }>(
			html,
			['conditionNameValid', 'readConditionEntries', 'scheduleConditions'],
			['vscode', 'conditionDebouncer', 'conditionsList'],
			[
				{ postMessage: (message: unknown) => messages.push(message) },
				{ schedule: (text: string, run: (text: string) => void) => scheduled.push({ text, run }) },
				list,
			]
		);
		compiled.scheduleConditions();
		assert.strictEqual(scheduled.length, 1);
		scheduled[0].run(scheduled[0].text);
		assert.deepStrictEqual(messages, [
			{ type: 'conditions', entries: [{ name: 'CANIPCORETYPE_SC', value: ' 1 ' }] },
		]);
	});

	test('an immediate send cancels a pending debounce, so a stale payload cannot overwrite it', () => {
		const html = page();
		const messages: unknown[] = [];
		let cancelled = 0;
		const list = { querySelectorAll: () => [fakeConditionRow('A_SC', ' 1 ')] };
		const compiled = compileWith<{ sendConditions(): void }>(
			html,
			['conditionNameValid', 'readConditionEntries', 'sendConditions'],
			['vscode', 'conditionDebouncer', 'conditionsList'],
			[
				{ postMessage: (message: unknown) => messages.push(message) },
				{ cancel: () => { cancelled++; }, schedule: () => 0 },
				list,
			]
		);
		compiled.sendConditions();
		assert.strictEqual(cancelled, 1, 'the pending timer is cancelled');
		assert.deepStrictEqual(messages, [
			{ type: 'conditions', entries: [{ name: 'A_SC', value: ' 1 ' }] },
		]);
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
		for (const selector of ['.conditions-panel', '.condition-row', '.conditions-hint']) {
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
