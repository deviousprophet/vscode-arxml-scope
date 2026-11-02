import * as assert from 'assert';

import { buildFileIndex, buildFileIndexChunked } from '../../core/index/indexBuilder';
import { IndexElement, IndexReference } from '../../core/index/indexModel';
import { fixtureText } from './modelTestUtils';

function element(elements: readonly IndexElement[], path: string): IndexElement {
	const found = elements.find((candidate) => candidate.path === path);
	assert.ok(found, `missing element ${path}`);
	return found;
}

function reference(references: readonly IndexReference[], definitionRef: string): IndexReference {
	const found = references.find((candidate) => candidate.definitionRef === definitionRef);
	assert.ok(found, `missing reference ${definitionRef}`);
	return found;
}

suite('indexBuilder (core)', () => {
	test('indexes modules, containers and their AR paths', () => {
		const file = buildFileIndex('file:///values.arxml', fixtureText('index/values.arxml'));
		assert.strictEqual(file.schemaRelease, '00048');
		assert.deepStrictEqual(file.packages, ['/Synthetic']);
		assert.strictEqual(file.elements.length, 6, 'module, Main, Sub and three parameter values');

		const module = element(file.elements, '/Synthetic/SampleModule');
		assert.strictEqual(module.kind, 'module');
		assert.strictEqual(module.shortName, 'SampleModule');
		assert.strictEqual(module.uuid, '0f8a6a1e-2a8f-4a2e-9d3b-6f2f0b1c4a10');
		assert.strictEqual(module.definitionRef, '/Synthetic/SampleModuleDef');
		assert.strictEqual(module.definitionDest, 'ECUC-MODULE-DEF');

		const main = element(file.elements, '/Synthetic/SampleModule/Main');
		assert.strictEqual(main.kind, 'container');
		assert.strictEqual(main.definitionDest, 'ECUC-PARAM-CONF-CONTAINER-DEF');

		const sub = element(file.elements, '/Synthetic/SampleModule/Main/Sub');
		assert.strictEqual(sub.kind, 'container');
	});

	test('indexes parameter values by definition ref and a source range', () => {
		const file = buildFileIndex('file:///values.arxml', fixtureText('index/values.arxml'));
		const parameters = file.elements.filter((candidate) => candidate.kind === 'parameter');
		assert.strictEqual(parameters.length, 3);
		const timeout = parameters.find(
			(candidate) => candidate.definitionRef === '/Synthetic/SampleModuleDef/Main/TimeoutSeconds'
		);
		assert.ok(timeout);
		assert.strictEqual(timeout.definitionDest, 'ECUC-INTEGER-PARAM-DEF');
		assert.strictEqual(timeout.path, undefined);
		assert.ok(timeout.range.end > timeout.range.start);
	});

	test('indexes reference targets, DEST and the source container path', () => {
		const file = buildFileIndex('file:///values.arxml', fixtureText('index/values.arxml'));
		assert.strictEqual(file.references.length, 1);
		const peer = reference(file.references, '/Synthetic/SampleModuleDef/Main/PeerRef');
		assert.strictEqual(peer.sourcePath, '/Synthetic/SampleModule/Main');
		assert.strictEqual(peer.targetRawPath, '/Synthetic/SampleModule/Main/Sub');
		assert.strictEqual(peer.targetDest, 'ECUC-CONTAINER-VALUE');
		assert.deepStrictEqual(peer.contextPaths, []);
	});

	test('indexes every definition kind with its metadata', () => {
		const file = buildFileIndex('file:///module-def.arxml', fixtureText('index/module-def.arxml'));
		assert.strictEqual(file.definitions.length, 11);

		const module = file.definitions.find((candidate) => candidate.path === '/Synthetic/SampleModuleDef');
		assert.ok(module);
		assert.strictEqual(module.kind, 'ECUC-MODULE-DEF');
		assert.strictEqual(module.lowerMultiplicity, '0');
		assert.strictEqual(module.upperMultiplicity, '1');
		assert.strictEqual(module.description, 'Synthetic module used by the index tests.');

		const main = file.definitions.find((candidate) => candidate.path === '/Synthetic/SampleModuleDef/Main');
		assert.ok(main);
		assert.strictEqual(main.kind, 'ECUC-PARAM-CONF-CONTAINER-DEF');
		assert.strictEqual(main.lowerMultiplicity, '1');
		assert.strictEqual(main.upperMultiplicity, '1');

		const timeout = file.definitions.find(
			(candidate) => candidate.path === '/Synthetic/SampleModuleDef/Main/TimeoutSeconds'
		);
		assert.ok(timeout);
		assert.strictEqual(timeout.lowerLimit, '0');
		assert.strictEqual(timeout.upperLimit, '65535');
		assert.strictEqual(timeout.defaultValue, '30');
		assert.strictEqual(timeout.description, 'Timeout in seconds.');

		const mode = file.definitions.find((candidate) => candidate.path === '/Synthetic/SampleModuleDef/Main/Mode');
		assert.ok(mode);
		assert.deepStrictEqual(mode.literals, ['FAST', 'SLOW']);
		assert.strictEqual(mode.defaultValue, 'FAST');

		const peer = file.definitions.find((candidate) => candidate.path === '/Synthetic/SampleModuleDef/Main/PeerRef');
		assert.ok(peer);
		assert.strictEqual(peer.destinationRef, '/Synthetic/Other');
		assert.strictEqual(peer.upperMultiplicity, '*');
	});

	test('chunked and whole parses build the same file index', () => {
		const text = fixtureText('index/module-def.arxml');
		const whole = buildFileIndex('file:///module-def.arxml', text);
		for (const size of [1, 5, 31, 1024]) {
			const chunks: string[] = [];
			for (let at = 0; at < text.length; at += size) {
				chunks.push(text.slice(at, at + size));
			}
			assert.deepStrictEqual(buildFileIndexChunked('file:///module-def.arxml', chunks), whole, `chunk size ${size}`);
		}
	});

	test('a file without ECUC content still contributes its packages', () => {
		const text = `<?xml version="1.0"?><AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>Empty</SHORT-NAME></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const file = buildFileIndex('file:///empty.arxml', text);
		assert.deepStrictEqual(file.packages, ['/Empty']);
		assert.deepStrictEqual(file.elements, []);
		assert.deepStrictEqual(file.definitions, []);
	});
});
