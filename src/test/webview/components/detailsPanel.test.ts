import * as assert from 'assert';

import {
	definitionRows,
	inspectorFields,
} from '../../../webview/components/sidebar/detailsPanel/detailsPanel';
import type { DefinitionInfo } from '../../../core/index/definitions';
import type { EcucRow } from '../../../core/ecuc/renderRows';

const DEFINITION: DefinitionInfo = {
	kind: 'ECUC-INTEGER-PARAM-DEF',
	type: 'Integer',
	range: '0 .. 65535',
	defaultValue: '30',
	multiplicity: '0..1',
	destination: '/P/Dest',
	literals: ['FAST', 'SLOW'],
	description: 'Timeout in seconds.',
	file: 'file:///work/module-def.arxml',
	fileName: 'module-def.arxml',
};

suite('details definition projection', () => {
	test('definition rows use the documented order and omit absent fields', () => {
		assert.deepStrictEqual(definitionRows(DEFINITION), [
			{ label: 'Definition type', value: 'Integer' },
			{ label: 'Range', value: '0 .. 65535' },
			{ label: 'Default', value: '30' },
			{ label: 'Multiplicity', value: '0..1' },
			{ label: 'Values', value: 'FAST, SLOW' },
			{ label: 'Destination', value: '/P/Dest' },
			{ label: 'Definition description', value: 'Timeout in seconds.' },
			{ label: 'Definition file', value: 'module-def.arxml' },
		]);

		const sparse = definitionRows({
			kind: 'ECUC-BOOLEAN-PARAM-DEF',
			type: 'Boolean',
			file: 'file:///defs.arxml',
			fileName: 'defs.arxml',
		});
		assert.deepStrictEqual(sparse, [
			{ label: 'Definition type', value: 'Boolean' },
			{ label: 'Definition file', value: 'defs.arxml' },
		]);
	});

	test('definition rows skip empty literal lists and absent optional fields', () => {
		const rows = definitionRows({
			kind: 'ECUC-ENUMERATION-PARAM-DEF',
			type: 'Enumeration',
			literals: [],
			defaultValue: '',
			file: 'file:///defs.arxml',
			fileName: 'defs.arxml',
		});
		assert.deepStrictEqual(rows, [
			{ label: 'Definition type', value: 'Enumeration' },
			{ label: 'Default', value: '' },
			{ label: 'Definition file', value: 'defs.arxml' },
		]);
	});

	test('inspectorFields reads context paths, the own-condition filter and annotations', () => {
		const own = { text: 'A == 1', state: 'true' as const, symbols: ['A'], values: {} };
		const fields = inspectorFields({
			id: 'p1',
			kind: 'parameter',
			level: 3,
			parentId: 'c1',
			subtreeSize: 0,
			posinset: 1,
			setsize: 1,
			hasChildren: false,
			label: 'TimeoutSeconds',
			shortName: 'Timeout',
			definitionRef: '/P/M/TimeoutSeconds',
			parameterType: 'Integer',
			formats: [],
			value: '42',
			valueKind: 'numeric',
			shownValue: '42',
			contextPaths: ['PkgA.PkgB', 'PkgA.PkgC'],
			title: '/P/M/TimeoutSeconds',
			meta: [
				{ cls: 'context', text: 'context Ignored.Path', title: '' },
				{ cls: 'variant', text: 'VariantA', title: '' },
				{ cls: 'condition', text: '[A == 1]', title: '' },
				{ cls: 'condition', text: '[B == 2]', title: '' },
				{ cls: 'annotation', text: 'first note', title: '' },
				{ cls: 'annotation', text: 'second note', title: '' },
			],
			condition: own,
			disabled: false,
			haystack: 'timeoutseconds 42',
		});
		assert.strictEqual(fields.context, 'PkgA.PkgB, PkgA.PkgC');
		assert.strictEqual(fields.variant, 'VariantA');
		assert.strictEqual(fields.conditions, '[B == 2]');
		assert.strictEqual(fields.annotations, 'first note\nsecond note');
		assert.strictEqual(fields.condition, own);

		const referenceRow: EcucRow = {
			id: 'p2',
			kind: 'reference',
			level: 3,
			parentId: 'c1',
			subtreeSize: 0,
			posinset: 1,
			setsize: 1,
			hasChildren: false,
			label: 'PeerIref',
			definitionRef: '/P/PeerIref',
			target: '/P/Target',
			title: '',
			meta: [{ cls: 'context', text: 'context Literal.Path', title: '' }],
			haystack: 'peeriref'
		};
		const noPaths = inspectorFields(referenceRow);
		assert.strictEqual(noPaths.context, 'Literal.Path');
		assert.strictEqual(noPaths.condition, undefined);
		assert.strictEqual(noPaths.definition, undefined);
		assert.strictEqual(noPaths.definitionCount, undefined);
	});

	test('inspectorFields carries the definition and still projects the row fields', () => {
		const fields = inspectorFields({
			id: 'p1',
			kind: 'parameter',
			level: 3,
			parentId: 'c1',
			subtreeSize: 0,
			posinset: 1,
			setsize: 1,
			hasChildren: false,
			label: 'TimeoutSeconds',
			definitionRef: '/P/M/TimeoutSeconds',
			definitionDest: 'ECUC-INTEGER-PARAM-DEF',
			parameterType: 'Integer',
			formats: [{ label: 'Decimal', value: '42' }],
			value: '42',
			valueKind: 'numeric',
			shownValue: '42',
			title: '/P/M/TimeoutSeconds',
			meta: [],
			haystack: 'timeoutseconds 42',
			definition: DEFINITION,
		});
		assert.strictEqual(fields.definition?.type, 'Integer');
		assert.strictEqual(fields.definition?.fileName, 'module-def.arxml');
		assert.strictEqual(fields.type, 'Integer');
		assert.strictEqual(fields.value, '42');
	});

	test('an ambiguous definition count is projected for Details', () => {
		const fields = inspectorFields({
			id: 'p1',
			kind: 'parameter',
			level: 3,
			parentId: 'c1',
			subtreeSize: 0,
			posinset: 1,
			setsize: 1,
			hasChildren: false,
			label: 'TimeoutSeconds',
			definitionRef: '/P/M/TimeoutSeconds',
			parameterType: 'Integer',
			formats: [],
			value: '42',
			valueKind: 'numeric',
			shownValue: '42',
			title: '/P/M/TimeoutSeconds',
			meta: [],
			haystack: 'timeoutseconds 42',
			definitionCount: 2,
		});
		assert.strictEqual(fields.definition, undefined);
		assert.strictEqual(fields.definitionCount, 2);
	});
});
