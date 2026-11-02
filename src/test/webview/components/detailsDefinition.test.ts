import * as assert from 'assert';

import {
	definitionRows,
	inspectorFields,
} from '../../../webview/components/sidebar/detailsPanel/detailsPanel';
import type { DefinitionInfo } from '../../../core/index/definitions';

const DEFINITION: DefinitionInfo = {
	kind: 'ECUC-INTEGER-PARAM-DEF',
	type: 'Integer',
	range: '0 .. 65535',
	defaultValue: '30',
	lowerMultiplicity: 0,
	upperMultiplicity: 1,
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
});
