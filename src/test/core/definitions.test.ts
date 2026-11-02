import * as assert from 'assert';

import { buildFileIndex } from '../../core/index/indexBuilder';
import {
	definitionInfo,
	definitionRange,
	definitionType,
	multiplicityText,
	multiplicityValue,
} from '../../core/index/definitions';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';
import { fixtureText } from './modelTestUtils';

const MODULE_DEF = buildFileIndex('file:///module-def.arxml', fixtureText('index/module-def.arxml'));

function definition(path: string) {
	const found = MODULE_DEF.definitions.find((candidate) => candidate.path === path);
	assert.ok(found, `missing definition ${path}`);
	return found;
}

suite('definitions (core)', () => {
	test('normalizes every supported definition kind', () => {
		const integer = definitionInfo(definition('/Synthetic/SampleModuleDef/Main/TimeoutSeconds'));
		assert.strictEqual(integer.kind, 'ECUC-INTEGER-PARAM-DEF');
		assert.strictEqual(integer.type, 'Integer');
		assert.strictEqual(integer.range, '0 .. 65535');
		assert.strictEqual(integer.defaultValue, '30');
		assert.strictEqual(integer.description, 'Timeout in seconds.');
		assert.strictEqual(integer.fileName, 'module-def.arxml');

		const float = definitionInfo(definition('/Synthetic/SampleModuleDef/Main/SampleRate'));
		assert.strictEqual(float.type, 'Float');
		assert.strictEqual(float.range, '0.5 .. 100');
		assert.strictEqual(float.defaultValue, '1.5');

		const boolean = definitionInfo(definition('/Synthetic/SampleModuleDef/Main/Enabled'));
		assert.strictEqual(boolean.type, 'Boolean');
		assert.strictEqual(boolean.defaultValue, 'true');

		const string = definitionInfo(definition('/Synthetic/SampleModuleDef/Main/Greeting'));
		assert.strictEqual(string.type, 'String');
		assert.strictEqual(string.range, '1 .. 32 chars');
		assert.strictEqual(string.defaultValue, 'hello');

		const enumeration = definitionInfo(definition('/Synthetic/SampleModuleDef/Main/Mode'));
		assert.strictEqual(enumeration.type, 'Enumeration');
		assert.deepStrictEqual(enumeration.literals, ['FAST', 'SLOW']);
		assert.strictEqual(enumeration.defaultValue, 'FAST');

		const functionName = definitionInfo(definition('/Synthetic/SampleModuleDef/Main/EntryPoint'));
		assert.strictEqual(functionName.type, 'Function name');
		const linker = definitionInfo(definition('/Synthetic/SampleModuleDef/Main/BufferSymbol'));
		assert.strictEqual(linker.type, 'Linker symbol');
	});

	test('normalizes container, module and reference multiplicity', () => {
		const module = definitionInfo(definition('/Synthetic/SampleModuleDef'));
		assert.strictEqual(module.type, 'Module');
		assert.strictEqual(module.multiplicity, '0..1');
		assert.strictEqual(module.description, 'Synthetic module used by the index tests.');

		const container = definitionInfo(definition('/Synthetic/SampleModuleDef/Main'));
		assert.strictEqual(container.type, 'Container');
		assert.strictEqual(container.multiplicity, '1');
		assert.strictEqual(container.description, 'Main settings for the synthetic sample.');

		const reference = definitionInfo(definition('/Synthetic/SampleModuleDef/Main/PeerRef'));
		assert.strictEqual(reference.type, 'Reference');
		assert.strictEqual(reference.multiplicity, '0..*');
		assert.strictEqual(reference.destination, '/Synthetic/Other');

		const instance = definitionInfo(definition('/Synthetic/SampleModuleDef/Main/PeerIref'));
		assert.strictEqual(instance.type, 'Instance reference');
		assert.strictEqual(instance.destination, '/Synthetic/SampleModule');
	});

	test('multiplicity parsing and display', () => {
		assert.strictEqual(multiplicityValue('0'), 0);
		assert.strictEqual(multiplicityValue('2'), 2);
		assert.strictEqual(multiplicityValue('*'), -1);
		assert.strictEqual(multiplicityValue('UNBOUNDED'), -1);
		assert.strictEqual(multiplicityValue('many'), undefined);
		assert.strictEqual(multiplicityText(0, 0), '0');
		assert.strictEqual(multiplicityText(1, 1), '1');
		assert.strictEqual(multiplicityText(0, 1), '0..1');
		assert.strictEqual(multiplicityText(0, -1), '0..*');
		assert.strictEqual(multiplicityText(2, undefined), '2..');
		assert.strictEqual(multiplicityText(undefined, undefined), undefined);
	});

	test('range display handles a single endpoint', () => {
		assert.strictEqual(
			definitionRange({
				path: '/P',
				kind: 'ECUC-INTEGER-PARAM-DEF',
				shortName: 'P',
				file: 'file:///x',
				range: { start: 0, end: 0 },
				lowerLimit: '0',
			}),
			'>= 0'
		);
		assert.strictEqual(
			definitionRange({
				path: '/P',
				kind: 'ECUC-STRING-PARAM-DEF',
				shortName: 'P',
				file: 'file:///x',
				range: { start: 0, end: 0 },
				maxLength: '8',
			}),
			'<= 8 chars'
		);
	});

	test('an unknown definition kind gets a readable fallback type', () => {
		assert.strictEqual(definitionType('ECUC-SPECIAL-PARAM-DEF'), 'Special param');
		assert.strictEqual(definitionType('CUSTOM'), 'Custom');
	});

	test('resolves definitions across files and refuses ambiguity', () => {
		const index = new WorkspaceIndex();
		index.upsert(MODULE_DEF);
		const timeout = index.definitionEntry('/Synthetic/SampleModuleDef/Main/TimeoutSeconds');
		assert.ok(timeout);
		assert.strictEqual(definitionInfo(timeout).type, 'Integer');
		assert.strictEqual(index.definitionEntry('/SampleModuleDef/Main/TimeoutSeconds')?.kind, 'ECUC-INTEGER-PARAM-DEF');
		assert.strictEqual(index.definitionEntry('/Missing'), undefined);

		// A second file with the same module definition path makes the exact path ambiguous.
		index.upsert(buildFileIndex('file:///module-def-2.arxml', fixtureText('index/module-def.arxml')));
		assert.strictEqual(index.definitionEntry('/Synthetic/SampleModuleDef/Main/TimeoutSeconds'), undefined);
	});
});
