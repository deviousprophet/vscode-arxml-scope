import * as assert from 'assert';

import { buildFileIndex } from '../../core/index/indexBuilder';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';
import { DEFAULT_SEVERITIES, normalizeSeverities } from '../../core/validation/types';
import { validateWorkspace } from '../../core/validation/validate';
import { fixtureText } from './modelTestUtils';

const DEFINITIONS = fixtureText('index/module-def.arxml');

function workspace(valuesText: string, definitionsText = DEFINITIONS): WorkspaceIndex {
	const index = new WorkspaceIndex();
	index.upsert(buildFileIndex('file:///values.arxml', valuesText));
	index.upsert(buildFileIndex('file:///module-def.arxml', definitionsText));
	return index;
}

function rules(index: WorkspaceIndex): string[] {
	return validateWorkspace(index, DEFAULT_SEVERITIES).map((diagnostic) => diagnostic.rule);
}

const CLEAN = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>Synthetic</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>SampleModule</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/Synthetic/SampleModuleDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/SampleModuleDef/Main</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;

suite('ECUC validation (core)', () => {
	test('a clean file has no diagnostics', () => {
		assert.deepStrictEqual(validateWorkspace(workspace(CLEAN), DEFAULT_SEVERITIES), []);
	});

	test('broken reference', () => {
		const text = CLEAN.replace(
			'<VALUE>42</VALUE>',
			'<VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/Synthetic/SampleModuleDef/Main/PeerRef</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/Missing/Target</VALUE-REF></ECUC-REFERENCE-VALUE><ECUC-NUMERICAL-PARAM-VALUE><VALUE>1</VALUE>'
		);
		const diagnostics = validateWorkspace(workspace(text), DEFAULT_SEVERITIES);
		assert.ok(diagnostics.some((diagnostic) => diagnostic.rule === 'brokenReference'));
	});

	test('DEST mismatch', () => {
		const text = CLEAN.replace(
			'<VALUE>42</VALUE>',
			'<VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/Synthetic/SampleModuleDef/Main/PeerRef</DEFINITION-REF><VALUE-REF DEST="ECUC-NUMERICAL-PARAM-VALUE">/Synthetic/SampleModule/Main</VALUE-REF></ECUC-REFERENCE-VALUE><ECUC-NUMERICAL-PARAM-VALUE><VALUE>1</VALUE>'
		);
		const diagnostics = validateWorkspace(workspace(text), DEFAULT_SEVERITIES);
		assert.ok(diagnostics.some((diagnostic) => diagnostic.rule === 'destMismatch'));
	});

	test('duplicate SHORT-NAME across files', () => {
		const index = workspace(CLEAN);
		index.upsert(buildFileIndex('file:///duplicate.arxml', CLEAN));
		assert.ok(rules(index).includes('duplicateShortName'));
	});

	test('value out of range and string length', () => {
		const high = CLEAN.replace('<VALUE>42</VALUE>', '<VALUE>70000</VALUE>');
		assert.ok(rules(workspace(high)).includes('valueOutOfRange'));

		const long = CLEAN.replace(
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
			'<ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Greeting</DEFINITION-REF><VALUE>' +
				'x'.repeat(40) +
				'</VALUE></ECUC-TEXTUAL-PARAM-VALUE>'
		);
		assert.ok(rules(workspace(long)).includes('valueOutOfRange'));
	});

	test('boolean and enumeration values are checked against the definition', () => {
		const boolean = CLEAN.replace(
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-BOOLEAN-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Enabled</DEFINITION-REF><VALUE>maybe</VALUE></ECUC-NUMERICAL-PARAM-VALUE>'
		);
		assert.ok(rules(workspace(boolean)).includes('valueOutOfRange'));

		const enumeration = CLEAN.replace(
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
			'<ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-ENUMERATION-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Mode</DEFINITION-REF><VALUE>TURBO</VALUE></ECUC-TEXTUAL-PARAM-VALUE>'
		);
		assert.ok(rules(workspace(enumeration)).includes('valueOutOfRange'));
	});

	test('multiplicity on a container', () => {
		const two = CLEAN.replace(
			'</CONTAINERS>',
			`<ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/SampleModuleDef/Main</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS>`
		);
		assert.ok(rules(workspace(two)).includes('multiplicity'));
	});

	test('missing definition', () => {
		const missing = CLEAN.replace('/Synthetic/SampleModuleDef/Main/TimeoutSeconds', '/Synthetic/Missing/Timeout');
		assert.ok(rules(workspace(missing)).includes('missingDefinition'));
	});

	test('missing required container', () => {
		const empty = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>Synthetic</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>SampleModule</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/Synthetic/SampleModuleDef</DEFINITION-REF></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		assert.ok(rules(workspace(empty)).includes('missingRequired'));
	});

	test('missing required parameter', () => {
		const definitions = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY><PARAMETERS><ECUC-INTEGER-PARAM-DEF><SHORT-NAME>P1</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY></ECUC-INTEGER-PARAM-DEF></PARAMETERS></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const values = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const diagnostics = validateWorkspace(workspace(values, definitions), DEFAULT_SEVERITIES);
		assert.ok(
			diagnostics.some(
				(diagnostic) => diagnostic.rule === 'missingRequired' && diagnostic.message.includes('parameter "P1"')
			)
		);
	});

	test('severity settings normalize unknown rules and values', () => {
		assert.deepStrictEqual(normalizeSeverities({ brokenReference: 'information', unknown: 'fatal' }), {
			...DEFAULT_SEVERITIES,
			brokenReference: 'information',
		});
		assert.deepStrictEqual(normalizeSeverities('not-an-object'), DEFAULT_SEVERITIES);
	});

	test('severity off removes only that rule', () => {
		const missing = CLEAN.replace('/Synthetic/SampleModuleDef/Main/TimeoutSeconds', '/Synthetic/Missing/Timeout');
		const diagnostics = validateWorkspace(workspace(missing), {
			...DEFAULT_SEVERITIES,
			missingDefinition: 'off',
		});
		assert.ok(!diagnostics.some((diagnostic) => diagnostic.rule === 'missingDefinition'));
	});
});
