/**
 * Condition entry normalization and the workspace store (task design §3).
 * The fake memento records exactly what the store writes, so the persistence
 * key and the no-file rule are visible here without an Extension Host.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import {
	CONDITION_VALUES_KEY,
	ConditionEntry,
	ConditionValueStore,
	parseConditionEntries,
} from '../../editor/conditionValues';

/** A minimal `Memento` with the same update/delete semantics. */
class FakeMemento implements vscode.Memento {
	private readonly values = new Map<string, unknown>();

	keys(): readonly string[] {
		return [...this.values.keys()];
	}

	get<T>(key: string, defaultValue?: T): T | undefined {
		if (this.values.has(key)) {
			return this.values.get(key) as T;
		}
		return defaultValue;
	}

	update(key: string, value: unknown): Thenable<void> {
		if (value === undefined) {
			this.values.delete(key);
		} else {
			this.values.set(key, value);
		}
		return Promise.resolve();
	}

	peek(key: string): unknown {
		return this.values.get(key);
	}
}

suite('condition values (design §3)', () => {
	test('non-array input normalizes to nothing instead of throwing', () => {
		for (const input of [undefined, null, 'abc', 42, {}, { entries: [] }]) {
			assert.deepStrictEqual(parseConditionEntries(input), {
				entries: [],
				values: new Map(),
				invalid: [],
			});
		}
	});

	test('names and values are trimmed; blank names are dropped', () => {
		const parsed = parseConditionEntries([
			{ name: '  A_SC  ', value: '  1  ' },
			{ name: '   ', value: '2' },
			{ name: 'B_SC', value: ' true ' },
		]);
		assert.deepStrictEqual(parsed.entries, [
			{ name: 'A_SC', value: '1' },
			{ name: 'B_SC', value: 'true' },
		]);
		assert.deepStrictEqual([...parsed.values], [
			['A_SC', 1],
			['B_SC', true],
		]);
		assert.deepStrictEqual(parsed.invalid, []);
	});

	test('invalid names are reported and not stored', () => {
		const parsed = parseConditionEntries([
			{ name: '1ABC', value: '1' },
			{ name: 'A B', value: '1' },
			{ name: 'A=B', value: '1' },
			{ name: '-A', value: '1' },
			{ name: 'OK_SC', value: '1' },
			{ name: '1ABC', value: '2' },
		]);
		assert.deepStrictEqual(parsed.invalid, ['1ABC', 'A B', 'A=B', '-A'], 'each bad name once');
		assert.deepStrictEqual(parsed.entries, [{ name: 'OK_SC', value: '1' }]);
	});

	test('a dot, dash or slash is legal in a full SYSC-REF tail', () => {
		const parsed = parseConditionEntries([
			{ name: 'Pkg.Mod/Sub/CANIPCORETYPE_SC', value: '1' },
			{ name: '/Pkg/SwSystemconsts/OTHER_SC', value: '2' },
			{ name: '_private', value: '0' },
		]);
		assert.deepStrictEqual(parsed.invalid, []);
		assert.strictEqual(parsed.values.get('Pkg.Mod/Sub/CANIPCORETYPE_SC'), 1);
		assert.strictEqual(parsed.values.get('/Pkg/SwSystemconsts/OTHER_SC'), 2);
		assert.strictEqual(parsed.values.get('_private'), 0);
	});

	test('later duplicates replace the value and keep the first position', () => {
		const parsed = parseConditionEntries([
			{ name: 'A_SC', value: '1' },
			{ name: 'B_SC', value: '2' },
			{ name: 'A_SC', value: '3' },
		]);
		assert.deepStrictEqual(parsed.entries, [
			{ name: 'A_SC', value: '3' },
			{ name: 'B_SC', value: '2' },
		]);
		assert.strictEqual(parsed.values.get('A_SC'), 3);
	});

	test('an empty value is unknown and stays visible as an entry', () => {
		const parsed = parseConditionEntries([
			{ name: 'A_SC', value: '' },
			{ name: 'B_SC', value: '2' },
		]);
		assert.deepStrictEqual(parsed.entries, [
			{ name: 'A_SC', value: '' },
			{ name: 'B_SC', value: '2' },
		]);
		assert.strictEqual(parsed.values.has('A_SC'), false, 'the empty value is not a known string');
		assert.strictEqual(parsed.values.get('B_SC'), 2);

		const cleared = parseConditionEntries([
			{ name: 'A_SC', value: '1' },
			{ name: 'A_SC', value: '' },
		]);
		assert.deepStrictEqual(cleared.entries, [{ name: 'A_SC', value: '' }], 'the entry stays for the table');
		assert.strictEqual(cleared.values.has('A_SC'), false, 'a later empty duplicate clears the value');

		const restored = parseConditionEntries([
			{ name: 'A_SC', value: '' },
			{ name: 'A_SC', value: '3' },
		]);
		assert.strictEqual(restored.values.get('A_SC'), 3, 'a later value restores it');
	});

	test('entries and values are capped at 200, values at 200 characters', () => {
		const many = Array.from({ length: 205 }, (_, at) => ({ name: `SC_${at}`, value: String(at) }));
		const parsed = parseConditionEntries(many);
		assert.strictEqual(parsed.entries.length, 200);
		assert.strictEqual(parsed.values.size, 200);
		assert.strictEqual(parsed.entries[199].name, 'SC_199');

		const long = parseConditionEntries([{ name: 'LONG_SC', value: 'x'.repeat(250) }]);
		assert.strictEqual(long.entries[0].value.length, 200);
		const longName = parseConditionEntries([{ name: 'A'.repeat(250), value: '1' }]);
		assert.strictEqual(longName.entries[0].name.length, 200, 'names are capped too');

		assert.strictEqual(parseConditionEntries([{ name: 'A', value: '1' }], 0).entries.length, 0);
		assert.strictEqual(parseConditionEntries([{ name: 'A', value: '1' }], 1).entries.length, 1);
	});

	test('raw values are parsed for evaluation but persisted exactly as entered', () => {
		const parsed = parseConditionEntries([
			{ name: 'NUM', value: '0x10' },
			{ name: 'BOOL', value: 'FALSE' },
			{ name: 'TEXT', value: 'hello' },
			{ name: 'QUOTED', value: '"hello"' },
		]);
		assert.strictEqual(parsed.values.get('NUM'), 16);
		assert.strictEqual(parsed.values.get('BOOL'), false);
		assert.strictEqual(parsed.values.get('TEXT'), 'hello');
		assert.strictEqual(parsed.values.get('QUOTED'), 'hello');
		assert.deepStrictEqual(
			parsed.entries.map((entry) => `${entry.name}=${entry.value}`),
			['NUM=0x10', 'BOOL=FALSE', 'TEXT=hello', 'QUOTED="hello"'],
			'the UI round-trips what the user typed'
		);
	});

	test('the store round-trips through workspaceState and clears through undefined', async () => {
		const memento = new FakeMemento();
		const store = new ConditionValueStore(memento);
		assert.deepStrictEqual(store.load(), [], 'an empty workspace starts with no values');

		const entries: ConditionEntry[] = [
			{ name: 'CANIPCORETYPE_SC', value: '1' },
			{ name: 'OTHER_SC', value: 'true' },
		];
		await store.save(entries);
		assert.ok(memento.peek(CONDITION_VALUES_KEY), 'the documented workspace key is used');
		assert.deepStrictEqual(store.load(), entries);

		await store.clear();
		assert.strictEqual(memento.peek(CONDITION_VALUES_KEY), undefined, 'clear removes the key');
		assert.deepStrictEqual(store.load(), []);
	});

	test('save normalizes too, so a bad caller cannot persist an unusable entry', async () => {
		const memento = new FakeMemento();
		const store = new ConditionValueStore(memento);
		await store.save([
			{ name: '  OK_SC  ', value: ' 1 ' },
			{ name: 'BAD NAME', value: '2' },
			{ name: '', value: '3' },
		]);
		assert.deepStrictEqual(memento.peek(CONDITION_VALUES_KEY), [{ name: 'OK_SC', value: '1' }]);
		assert.deepStrictEqual(store.load(), [{ name: 'OK_SC', value: '1' }]);
	});

	test('load normalizes a hand-edited or old stored value', () => {
		const memento = new FakeMemento();
		void memento.update(CONDITION_VALUES_KEY, [
			{ name: '  OK_SC  ', value: ' 1 ' },
			{ name: 'BAD NAME', value: '2' },
			{ name: 3, value: 'ignored' },
			'not an entry',
		]);
		const store = new ConditionValueStore(memento);
		assert.deepStrictEqual(store.load(), [{ name: 'OK_SC', value: '1' }]);
	});
});
