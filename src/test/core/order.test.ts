import * as assert from 'assert';

import { ContainerNode, ModuleNode, ParameterNode, ReferenceNode } from '../../core/ecuc/model';
import { SORT_EXCEPTIONS, orderContainers, orderMembers, orderModules } from '../../core/ecuc/order';
import { scanFixture } from './modelTestUtils';

/** Minimal node builders; only the fields the ordering reads are meaningful. */
function parameter(definitionRef: string, value?: string): ParameterNode {
	return {
		kind: 'parameter',
		numeric: false,
		definitionRef,
		name: definitionRef.slice(definitionRef.lastIndexOf('/') + 1),
		displayValue: value,
		range: { start: 0, end: 0 },
	};
}

function reference(definitionRef: string, target?: string): ReferenceNode {
	return {
		kind: 'reference',
		instance: false,
		definitionRef,
		name: definitionRef.slice(definitionRef.lastIndexOf('/') + 1),
		targetRawPath: target,
		contextPaths: [],
		range: { start: 0, end: 0 },
	};
}

function moduleOf(definitionRef: string, shortName: string): ModuleNode {
	return {
		kind: 'module',
		definitionRef,
		shortName,
		range: { start: 0, end: 0 },
		containers: [],
	};
}

function containerOf(definitionRef: string, shortName: string): ContainerNode {
	return {
		kind: 'container',
		definitionRef,
		shortName,
		range: { start: 0, end: 0 },
		containerPath: [],
		parameters: [],
		references: [],
		containers: [],
	};
}

const names = (nodes: { name: string; displayValue?: string }[]): string[] =>
	nodes.map((n) => (n.displayValue === undefined ? n.name : `${n.name}=${n.displayValue}`));

/**
 * Independent oracle: the legacy sort key from
 * `research/legacy-artext-analysis.md` §2.4, implemented here as a plain string
 * so the tuple implementation is checked against the rule, not against itself.
 */
function legacySort<T>(items: T[], key: (item: T) => string): T[] {
	return items.slice().sort((a, b) => {
		const ka = key(a);
		const kb = key(b);
		return ka < kb ? -1 : ka > kb ? 1 : 0;
	});
}

function legacyParameterKey(except: readonly string[]) {
	return (p: ParameterNode): string => {
		const tail = p.definitionRef.slice(p.definitionRef.lastIndexOf('/') + 1);
		return except.includes(tail) ? p.definitionRef : `${p.definitionRef}"${p.displayValue ?? ''}"`;
	};
}

suite('order (core)', () => {
	test('AC5: sort all orders by DEFINITION-REF then identity, exceptions by declaration order', () => {
		const authored = scanFixture('exceptions.arxml').modules[0].containers[0].parameters;
		assert.deepStrictEqual(names(authored), [
			'Zeta=63',
			'DcmDspDidRef=2',
			'Alpha=7',
			'DemDidClassRef=5',
			'DcmDspDidRef=1',
			'Beta=8',
		]);

		const sorted = orderMembers(authored, [], 'all', SORT_EXCEPTIONS).parameters;
		assert.deepStrictEqual(names(sorted), [
			'Alpha=7',
			'Beta=8',
			'DcmDspDidRef=2', // exception entries: declaration order kept among themselves
			'DcmDspDidRef=1',
			'DemDidClassRef=5',
			'Zeta=63',
		]);

		// Same order as the legacy `DEFINITION-REF + '"' + identity + '"'` key.
		assert.deepStrictEqual(names(legacySort(authored, legacyParameterKey(SORT_EXCEPTIONS))), names(sorted));
	});

	test('AC5: a DEFINITION-REF that is a prefix of another sorts as the legacy string key does', () => {
		const items = [
			parameter('/D/Name', 'b'),
			parameter('/D/NameExtra', 'a'),
			parameter('/D/Name', 'a'),
			parameter('/D/Name/Child', 'a'),
		];
		const sorted = orderMembers(items, [], 'all', []).parameters;
		assert.deepStrictEqual(names(sorted), ['Name=a', 'Name=b', 'Child=a', 'NameExtra=a']);
		// The legacy string key produces the same order.
		assert.deepStrictEqual(names(legacySort(items, legacyParameterKey([]))), names(sorted));
		// Legacy key order, asserted directly: `"` sorts below every legal path character.
		assert.ok(legacyParameterKey([])(parameter('/D/Name', 'a')) < legacyParameterKey([])(parameter('/D/NameExtra', 'a')));
		assert.ok(legacyParameterKey([])(parameter('/D/Name', 'a')) < legacyParameterKey([])(parameter('/D/Name/Child', 'a')));
		assert.ok(legacyParameterKey([])(parameter('/D/Name/Child', 'a')) < legacyParameterKey([])(parameter('/D/NameExtra', 'a')));
	});

	test('AC5: parameters and references never interleave', () => {
		const container = scanFixture('basic.arxml').modules[0].containers[0];
		assert.deepStrictEqual(names(container.parameters), ['IniValue=63', 'Title=hello']);
		assert.deepStrictEqual(
			container.references.map((r) => r.name),
			['PeerRef', 'PeerIref']
		);

		const ordered = orderMembers(container.parameters, container.references, 'all', SORT_EXCEPTIONS);
		assert.strictEqual(ordered.parameters.length, container.parameters.length);
		assert.strictEqual(ordered.references.length, container.references.length);
		assert.ok(ordered.parameters.every((p) => p.kind === 'parameter'));
		assert.ok(ordered.references.every((r) => r.kind === 'reference'));
		// Identities come from the value for parameters and the raw target for references.
		assert.deepStrictEqual(
			orderMembers(
				[parameter('/D/P', 'zzz'), parameter('/D/P', 'aaa')],
				[reference('/D/R', '/zzz'), reference('/D/R', '/aaa')],
				'all',
				[]
			).parameters.map((p) => p.displayValue),
			['aaa', 'zzz']
		);
	});

	test('AC5: modules and containers order by definitionRef then shortName', () => {
		const modules = [moduleOf('/D/M2', 'Zed'), moduleOf('/D/M1', 'B'), moduleOf('/D/M1', 'A')];
		assert.deepStrictEqual(
			orderModules(modules, 'all', []).map((m) => `${m.definitionRef}:${m.shortName}`),
			['/D/M1:A', '/D/M1:B', '/D/M2:Zed']
		);
		const containers = [containerOf('/D/C', 'B'), containerOf('/D/C', 'A')];
		assert.deepStrictEqual(
			orderContainers(containers, 'all', []).map((c) => c.shortName),
			['A', 'B']
		);
		// A container definition tail in the exception list also keeps declaration order.
		const excepted = [
			containerOf('/D/EcuMDriverInitItem', 'B'),
			containerOf('/D/EcuMDriverInitItem', 'A'),
			containerOf('/D/Other', 'Z'),
		];
		assert.deepStrictEqual(
			orderContainers(excepted, 'all', SORT_EXCEPTIONS).map((c) => c.shortName),
			['B', 'A', 'Z']
		);
	});

	test('AC6: declaration mode returns the authored order for every list', () => {
		const model = scanFixture('exceptions.arxml');
		const container = model.modules[0].containers[0];
		assert.deepStrictEqual(
			names(orderMembers(container.parameters, container.references, 'declaration', SORT_EXCEPTIONS).parameters),
			['Zeta=63', 'DcmDspDidRef=2', 'Alpha=7', 'DemDidClassRef=5', 'DcmDspDidRef=1', 'Beta=8']
		);
		assert.deepStrictEqual(
			orderMembers([], [], 'declaration', SORT_EXCEPTIONS).references.map((r) => r.name),
			[]
		);

		// References: authored order is returned, in their own list.
		const basicReferences = scanFixture('basic.arxml').modules[0].containers[0].references;
		assert.deepStrictEqual(
			orderMembers([], basicReferences, 'declaration', SORT_EXCEPTIONS).references.map((r) => r.name),
			['PeerRef', 'PeerIref']
		);

		const references = scanFixture('references.arxml').modules[0].containers;
		assert.deepStrictEqual(
			orderContainers(references, 'declaration', SORT_EXCEPTIONS).map((c) => c.shortName),
			['C1', 'X', 'Y']
		);
		const basic = scanFixture('basic.arxml').modules[0];
		assert.deepStrictEqual(
			orderModules([basic], 'declaration', SORT_EXCEPTIONS).map((m) => m.shortName),
			['ModA']
		);

		// Sorting is pure: the authored arrays are untouched.
		const before = names(container.parameters).join(',');
		orderMembers(container.parameters, container.references, 'all', SORT_EXCEPTIONS);
		assert.strictEqual(names(container.parameters).join(','), before);
	});

	test('the exception list is the 15 entries from the legacy launcher', () => {
		assert.strictEqual(SORT_EXCEPTIONS.length, 15);
		assert.deepStrictEqual(SORT_EXCEPTIONS.slice(0, 3), [
			'DcmDspDidRef',
			'DcmDspRequestRoutineResultsOutSignal',
			'DcmDspStartRoutineInSignal',
		]);
		assert.strictEqual(SORT_EXCEPTIONS[SORT_EXCEPTIONS.length - 1], 'EcuMRbCallOutItem');
	});
});
