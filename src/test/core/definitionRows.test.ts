import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { EcucRow, buildRows } from '../../core/ecuc/renderRows';
import { definitionInfo, DefinitionLookup } from '../../core/index/definitions';
import { buildFileIndex } from '../../core/index/indexBuilder';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';
import { fixtureText } from './modelTestUtils';

const model = scanEcucValues(fixtureText('index/values.arxml'));
const index = new WorkspaceIndex();
index.upsert(buildFileIndex('file:///module-def.arxml', fixtureText('index/module-def.arxml')));

function lookup(definitionRef: string) {
	const entry = index.definitionEntry(definitionRef);
	return entry === undefined ? undefined : definitionInfo(entry);
}

function row(rows: readonly EcucRow[], label: string): EcucRow {
	const found = rows.find((candidate) => candidate.label === label);
	assert.ok(found, `missing row ${label}`);
	return found;
}

function assertTypeAndRange(candidate: EcucRow, type: string, range: string): void {
	assert.strictEqual(candidate.definition?.type, type);
	assert.strictEqual(candidate.definition?.range, range);
}

function assertDefaultAndDescription(candidate: EcucRow, defaultValue: string, description: string): void {
	assert.strictEqual(candidate.definition?.defaultValue, defaultValue);
	assert.strictEqual(candidate.definition?.description, description);
}

function assertTypeAndMultiplicity(candidate: EcucRow, type: string, multiplicity: string): void {
	assert.strictEqual(candidate.definition?.type, type);
	assert.strictEqual(candidate.definition?.multiplicity, multiplicity);
}

function assertParameterRows(rows: readonly EcucRow[]): void {
	const timeout = row(rows, 'TimeoutSeconds');
	assertTypeAndRange(timeout, 'Integer', '0 .. 65535');
	assertDefaultAndDescription(timeout, '30', 'Timeout in seconds.');
}

function assertContainerRow(rows: readonly EcucRow[]): void {
	const main = row(rows, 'Main');
	assertTypeAndMultiplicity(main, 'Container', '1');
}

function assertModuleRow(rows: readonly EcucRow[]): void {
	const module = rows.find((candidate) => candidate.kind === 'module');
	assert.ok(module);
	assertTypeAndMultiplicity(module, 'Module', '0..1');
}

suite('definition rows (core)', () => {
	test('a resolved definition enriches parameter, container and module rows', () => {
		const { rows } = buildRows(model, { definitions: lookup });
		assertParameterRows(rows);
		assertContainerRow(rows);
		assertModuleRow(rows);
	});

	test('a resolved reference definition adds its destination and multiplicity', () => {
		const { rows } = buildRows(model, { definitions: lookup });
		const peer = row(rows, 'PeerRef');
		assert.strictEqual(peer.definition?.type, 'Reference');
		assert.strictEqual(peer.definition?.destination, 'ECUC-REFERENCE-DEF');
		assert.strictEqual(peer.definition?.multiplicity, '0..*');
	});

	test('without a lookup no row carries a definition', () => {
		const { rows } = buildRows(model);
		assert.ok(rows.length > 0);
		for (const candidate of rows) {
			assert.strictEqual(candidate.definition, undefined, `${candidate.label} must not have a definition`);
		}
	});

	test('an unresolved reference adds nothing and never invents a value', () => {
		const empty: DefinitionLookup = () => undefined;
		const { rows } = buildRows(model, { definitions: empty });
		for (const candidate of rows) {
			assert.strictEqual(candidate.definition, undefined);
		}
	});

	test('an ambiguous definition exposes its count without picking one', () => {
		const { rows } = buildRows(model, {
			definitions: () => undefined,
			ambiguousDefinitions: () => 2,
		});
		const timeout = row(rows, 'TimeoutSeconds');
		assert.strictEqual(timeout.definition, undefined);
		assert.strictEqual(timeout.definitionCount, 2);
	});

	test('a throwing definition lookup never blocks the row document', () => {
		const throwing: DefinitionLookup = () => {
			throw new Error('index corrupt');
		};
		assert.doesNotThrow(() => buildRows(model, { definitions: throwing }));
		const { rows } = buildRows(model, { definitions: throwing });
		assert.ok(rows.length > 0);
		assert.strictEqual(row(rows, 'TimeoutSeconds').definition, undefined);
	});

	test('the lookup is not called for rows without a definition ref', () => {
		let calls = 0;
		const counting: DefinitionLookup = () => {
			calls++;
			return undefined;
		};
		buildRows(model, { definitions: counting });
		// Module, Main, Sub, three parameters and one reference all have a ref.
		assert.strictEqual(calls, 7);
	});
});
