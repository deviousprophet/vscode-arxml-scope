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

const VARIANT_DEFINITIONS = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>0</LOWER-MULTIPLICITY><UPPER-MULTIPLICITY>1</UPPER-MULTIPLICITY></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;

function variantValues(guards: readonly string[]): string {
	const containers = guards
		.map(
			(guard) =>
				`<ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF>${
					guard === '' ? '' : `<VARIATION-POINT><SW-SYSCOND>${guard}</SW-SYSCOND></VARIATION-POINT>`
				}</ECUC-CONTAINER-VALUE>`
		)
		.join('');
	return `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

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
			'<VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/Synthetic/SampleModuleDef/Main/PeerRef</DEFINITION-REF><VALUE-REF DEST="ECUC-MODULE-CONFIGURATION-VALUES">/Synthetic/SampleModule/Main</VALUE-REF></ECUC-REFERENCE-VALUE><ECUC-NUMERICAL-PARAM-VALUE><VALUE>1</VALUE>'
		);
		const diagnostics = validateWorkspace(workspace(text), DEFAULT_SEVERITIES);
		assert.ok(diagnostics.some((diagnostic) => diagnostic.rule === 'destMismatch'));
	});

	test('duplicate SHORT-NAME across files', () => {
		const index = workspace(CLEAN);
		index.upsert(buildFileIndex('file:///duplicate.arxml', CLEAN));
		const diagnostics = validateWorkspace(index, DEFAULT_SEVERITIES);
		const duplicates = diagnostics.filter(
			(diagnostic) => diagnostic.rule === 'duplicateShortName' && diagnostic.message.includes('/Synthetic/SampleModule/Main')
		);
		assert.strictEqual(duplicates.length, 1);
		assert.strictEqual(duplicates[0].severity, 'information');
		assert.ok((duplicates[0].related?.length ?? 0) >= 1);
	});

	test('non-ECUC and parameter-value DESTs are not judged', () => {
		const text = CLEAN.replace(
			'<VALUE>42</VALUE>',
			'<VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/Synthetic/SampleModuleDef/Main/PeerRef</DEFINITION-REF><VALUE-REF DEST="SW-ADDR-METHOD">/Synthetic/Missing/Method</VALUE-REF></ECUC-REFERENCE-VALUE><ECUC-NUMERICAL-PARAM-VALUE><VALUE>1</VALUE>'
		);
		const diagnostics = validateWorkspace(workspace(text), DEFAULT_SEVERITIES);
		assert.ok(!diagnostics.some((diagnostic) => diagnostic.rule === 'brokenReference'));
	});

	test('empty values and AUTOSAR boolean/float literals are accepted', () => {
		const empty = CLEAN.replace('<VALUE>42</VALUE>', '<VALUE></VALUE>');
		assert.ok(!rules(workspace(empty)).includes('valueOutOfRange'));

		const bool = CLEAN.replace(
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-BOOLEAN-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Enabled</DEFINITION-REF><VALUE>1</VALUE></ECUC-NUMERICAL-PARAM-VALUE>'
		);
		assert.ok(!rules(workspace(bool)).includes('valueOutOfRange'));

		const infinity = CLEAN.replace(
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-FLOAT-PARAM-DEF">/Synthetic/SampleModuleDef/Main/SampleRate</DEFINITION-REF><VALUE>INF</VALUE></ECUC-NUMERICAL-PARAM-VALUE>'
		);
		assert.ok(!rules(workspace(infinity)).includes('valueOutOfRange'));
	});

	test('required ADD-INFO and default-valued parameters are not missing', () => {
		const definitions = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY><PARAMETERS><ECUC-ADD-INFO-PARAM-DEF><SHORT-NAME>A</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY></ECUC-ADD-INFO-PARAM-DEF><ECUC-INTEGER-PARAM-DEF><SHORT-NAME>P1</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY><DEFAULT-VALUE>0</DEFAULT-VALUE></ECUC-INTEGER-PARAM-DEF></PARAMETERS></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const values = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const missing = validateWorkspace(workspace(values, definitions), DEFAULT_SEVERITIES).filter(
			(diagnostic) => diagnostic.rule === 'missingRequired'
		);
		assert.ok(!missing.some((diagnostic) => diagnostic.message.includes('"A"')));
		assert.ok(!missing.some((diagnostic) => diagnostic.message.includes('"P1"')));
	});

	test('a missing module definition is one diagnostic, not one per child', () => {
		const values = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/D/M</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/D/M/C</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/D/M/C/P</DEFINITION-REF><VALUE>1</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const missing = validateWorkspace(workspace(values, '<AUTOSAR/>'), DEFAULT_SEVERITIES).filter(
			(diagnostic) => diagnostic.rule === 'missingDefinition'
		);
		assert.strictEqual(missing.length, 1);
		assert.ok(missing[0].message.includes('"/D/M"'));
		assert.ok(missing[0].message.includes('3 instances'));
	});

	test('cross-file copies are not summed by multiplicity', () => {
		const definitions = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY><UPPER-MULTIPLICITY>1</UPPER-MULTIPLICITY></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const values = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const index = workspace(values, definitions);
		index.upsert(buildFileIndex('file:///copy.arxml', values));
		assert.ok(!rules(index).includes('multiplicity'));
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

	test('cross-file rules follow auto/always/never', () => {
		const broken = CLEAN.replace(
			'<VALUE>42</VALUE>',
			'<VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/Synthetic/SampleModuleDef/Main/PeerRef</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/Missing/Target</VALUE-REF></ECUC-REFERENCE-VALUE><ECUC-NUMERICAL-PARAM-VALUE><VALUE>1</VALUE>'
		);
		const fragment = validateWorkspace(workspace(broken, '<AUTOSAR/>'), DEFAULT_SEVERITIES, 'auto');
		assert.ok(!fragment.some((diagnostic) => diagnostic.rule === 'brokenReference'));
		const forced = validateWorkspace(workspace(broken, '<AUTOSAR/>'), DEFAULT_SEVERITIES, 'always');
		assert.ok(forced.some((diagnostic) => diagnostic.rule === 'brokenReference'));
		const complete = validateWorkspace(workspace(broken), DEFAULT_SEVERITIES, 'auto');
		assert.ok(complete.some((diagnostic) => diagnostic.rule === 'brokenReference'));
		const never = validateWorkspace(workspace(broken), DEFAULT_SEVERITIES, 'never');
		assert.ok(!never.some((diagnostic) => diagnostic.rule === 'brokenReference'));
	});

	test('never keeps a same-file duplicate but hides a cross-file one', () => {
		const sameFile = CLEAN.replace(
			'</CONTAINERS>',
			'<ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/SampleModuleDef/Main</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS>'
		);
		const index = workspace(sameFile);
		const diagnostics = validateWorkspace(index, DEFAULT_SEVERITIES, 'never');
		assert.ok(diagnostics.some((diagnostic) => diagnostic.rule === 'duplicateShortName'));

		const cross = workspace(CLEAN);
		cross.upsert(buildFileIndex('file:///duplicate.arxml', CLEAN));
		const hidden = validateWorkspace(cross, DEFAULT_SEVERITIES, 'never');
		assert.ok(!hidden.some((diagnostic) => diagnostic.rule === 'duplicateShortName'));
	});

	test('severity off removes only that rule', () => {
		const missing = CLEAN.replace('/Synthetic/SampleModuleDef/Main/TimeoutSeconds', '/Synthetic/Missing/Timeout');
		const diagnostics = validateWorkspace(workspace(missing), {
			...DEFAULT_SEVERITIES,
			missingDefinition: 'off',
		});
		assert.ok(!diagnostics.some((diagnostic) => diagnostic.rule === 'missingDefinition'));
	});

	test('split container copies across files are not duplicates', () => {
		const other = CLEAN.replace(
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
			'<ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Greeting</DEFINITION-REF><VALUE>hi</VALUE></ECUC-TEXTUAL-PARAM-VALUE>'
		);
		const index = workspace(CLEAN);
		index.upsert(buildFileIndex('file:///split.arxml', other));
		const duplicates = validateWorkspace(index, DEFAULT_SEVERITIES).filter(
			(diagnostic) => diagnostic.rule === 'duplicateShortName'
		);
		assert.deepStrictEqual(duplicates, []);
	});

	test('a same-file split copy is still a duplicate', () => {
		const two = CLEAN.replace(
			'</CONTAINERS>',
			'<ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/SampleModuleDef/Main</DEFINITION-REF><PARAMETER-VALUES><ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Greeting</DEFINITION-REF><VALUE>hi</VALUE></ECUC-TEXTUAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS>'
		);
		const diagnostics = validateWorkspace(workspace(two), DEFAULT_SEVERITIES);
		assert.ok(
			diagnostics.some(
				(diagnostic) =>
					diagnostic.rule === 'duplicateShortName' &&
					diagnostic.message.includes('/Synthetic/SampleModule/Main')
			)
		);
	});

	test('a same-path different-definition copy is still a duplicate', () => {
		const two = CLEAN.replace(
			'</CONTAINERS>',
			'<ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/OtherDef/Main</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS>'
		);
		const diagnostics = validateWorkspace(workspace(two), DEFAULT_SEVERITIES);
		assert.ok(
			diagnostics.some(
				(diagnostic) =>
					diagnostic.rule === 'duplicateShortName' &&
					diagnostic.message.includes('/Synthetic/SampleModule/Main')
			)
		);
	});

	test('variant alternatives do not violate the upper multiplicity or duplicate rules', () => {
		const variants = workspace(variantValues(['(A==1)', '(A!=1)']), VARIANT_DEFINITIONS);
		assert.ok(!rules(variants).includes('multiplicity'));
		assert.ok(!rules(variants).includes('duplicateShortName'));
	});

	test('same-guard, unguarded and partially guarded repetitions still violate multiplicity', () => {
		assert.ok(rules(workspace(variantValues(['(A==1)', '(A==1)']), VARIANT_DEFINITIONS)).includes('multiplicity'));
		assert.ok(rules(workspace(variantValues(['', '']), VARIANT_DEFINITIONS)).includes('multiplicity'));
		assert.ok(rules(workspace(variantValues(['', '(A==1)']), VARIANT_DEFINITIONS)).includes('multiplicity'));
	});

	test('WITH-AUTO parameters are not missing but still parsed', () => {
		const definitions = (marker: string) =>
			`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY><PARAMETERS><ECUC-INTEGER-PARAM-DEF><SHORT-NAME>P1</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY>${marker}</ECUC-INTEGER-PARAM-DEF></PARAMETERS></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const values = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const auto = workspace(values, definitions('<WITH-AUTO>true</WITH-AUTO>'));
		assert.strictEqual(auto.definitionEntry('/P/MDef/C/P1')?.withAuto, true);
		assert.ok(!rules(auto).includes('missingRequired'));
		assert.ok(rules(workspace(values, definitions('<WITH-AUTO>false</WITH-AUTO>'))).includes('missingRequired'));
		assert.ok(rules(workspace(values, definitions(''))).includes('missingRequired'));
	});
});
