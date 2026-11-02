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

suite('definition rows (core)', () => {
	test('a resolved definition enriches parameter, container and module rows', () => {
		const { rows } = buildRows(model, { definitions: lookup });
		const timeout = row(rows, 'TimeoutSeconds');
		assert.strictEqual(timeout.definition?.type, 'Integer');
		assert.strictEqual(timeout.definition?.range, '0 .. 65535');
		assert.strictEqual(timeout.definition?.defaultValue, '30');
		assert.strictEqual(timeout.definition?.description, 'Timeout in seconds.');

		const main = row(rows, 'Main');
		assert.strictEqual(main.definition?.type, 'Container');
		assert.strictEqual(main.definition?.multiplicity, '1');

		const module = rows.find((candidate) => candidate.kind === 'module');
		assert.ok(module);
		assert.strictEqual(module.definition?.type, 'Module');
		assert.strictEqual(module.definition?.multiplicity, '0..1');
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
