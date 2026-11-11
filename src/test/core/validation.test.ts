import * as assert from 'assert';

import { buildFileIndex } from '../../core/index/indexBuilder';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';
import { DEFAULT_SEVERITIES, normalizeSeverities } from '../../core/validation/types';
import { validateWorkspace, validateWorkspaceSlices } from '../../core/validation/validate';
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

	test('the sliced pass yields and returns the synchronous diagnostics', () => {
		const containers = Array.from(
			{ length: 4200 },
			(_, at) =>
				`<ECUC-CONTAINER-VALUE><SHORT-NAME>C${at}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF></ECUC-CONTAINER-VALUE>`
		).join('');
		const text = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const index = new WorkspaceIndex();
		index.upsert(buildFileIndex('file:///values.arxml', text));
		index.upsert(buildFileIndex('file:///module-def.arxml', VARIANT_DEFINITIONS));

		const sync = validateWorkspace(index, DEFAULT_SEVERITIES);
		const iterator = validateWorkspaceSlices(index, DEFAULT_SEVERITIES);
		let slices = 0;
		while (true) {
			const step = iterator.next();
			if (step.done) {
				assert.deepStrictEqual(step.value, sync);
				break;
			}
			slices++;
		}
		assert.ok(slices > 0, 'the pass yields at least once');
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

	test('integer, float and string problems name the broken rule', () => {
		const valueOf = (value: string): string => CLEAN.replace('<VALUE>42</VALUE>', `<VALUE>${value}</VALUE>`);
		const messages = (text: string, definitions = DEFINITIONS): string[] =>
			validateWorkspace(workspace(text, definitions), DEFAULT_SEVERITIES)
				.filter((diagnostic) => diagnostic.rule === 'valueOutOfRange')
				.map((diagnostic) => diagnostic.message);

		assert.deepStrictEqual(messages(valueOf('abc')), ['Value "abc" is not a valid integer.']);
		assert.deepStrictEqual(messages(valueOf('-1')), ['Value "-1" is below the lower limit 0.']);
		assert.deepStrictEqual(messages(valueOf('70000')), ['Value "70000" is above the upper limit 65535.']);

		const float = (value: string): string =>
			CLEAN.replace(
				'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
				`<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-FLOAT-PARAM-DEF">/Synthetic/SampleModuleDef/Main/SampleRate</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`
			);
		assert.deepStrictEqual(messages(float('abc')), ['Value "abc" is not a valid float.']);
		assert.deepStrictEqual(messages(float('0.1')), ['Value "0.1" is below the minimum 0.5.']);
		assert.deepStrictEqual(messages(float('101')), ['Value "101" is above the maximum 100.']);

		const text = (value: string): string =>
			CLEAN.replace(
				'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
				`<ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Greeting</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-TEXTUAL-PARAM-VALUE>`
			);
		assert.deepStrictEqual(
			messages(text('a'), DEFINITIONS.replace('<MIN-LENGTH>1</MIN-LENGTH>', '<MIN-LENGTH>2</MIN-LENGTH>')),
			['Value "a" is shorter than 2 characters.']
		);
		assert.deepStrictEqual(messages(text('x'.repeat(40))), [
			'Value "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" is longer than 32 characters.',
		]);
	});

	test('unknown definition kinds and literal-less enumerations accept any value', () => {
		const functionValue = CLEAN.replace(
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
			'<ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-FUNCTION-NAME-DEF">/Synthetic/SampleModuleDef/Main/EntryPoint</DEFINITION-REF><VALUE>anything</VALUE></ECUC-TEXTUAL-PARAM-VALUE>'
		);
		assert.ok(!rules(workspace(functionValue)).includes('valueOutOfRange'));

		const enumeration = (definitions: string): string =>
			CLEAN.replace(
				'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
				'<ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-ENUMERATION-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Mode</DEFINITION-REF><VALUE>TURBO</VALUE></ECUC-TEXTUAL-PARAM-VALUE>'
			);
		const withoutLiterals = DEFINITIONS.replace(/<LITERALS>[\s\S]*<\/LITERALS>/, '');
		assert.ok(!rules(workspace(enumeration(withoutLiterals), withoutLiterals)).includes('valueOutOfRange'));
	});

	test('multiplicity messages cover equal bounds, ranges, infinities and guards', () => {
		const definitions = (multiplicity: string): string =>
			`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME>${multiplicity}</ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const containers = (count: number, guard?: string): string =>
			`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS>${Array.from(
				{ length: count },
				() =>
					`<ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF>${
						guard === undefined ? '' : `<VARIATION-POINT><SW-SYSCOND>${guard}</SW-SYSCOND></VARIATION-POINT>`
					}</ECUC-CONTAINER-VALUE>`
			).join('')}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const message = (count: number, multiplicity: string, guard?: string): string | undefined =>
			validateWorkspace(workspace(containers(count, guard), definitions(multiplicity)), DEFAULT_SEVERITIES).find(
				(diagnostic) => diagnostic.rule === 'multiplicity'
			)?.message;

		assert.strictEqual(
			message(1, '<LOWER-MULTIPLICITY>2</LOWER-MULTIPLICITY><UPPER-MULTIPLICITY>2</UPPER-MULTIPLICITY>'),
			'"C" occurs 1 times in this file; the definition allows 2.'
		);
		assert.strictEqual(
			message(3, '<LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY><UPPER-MULTIPLICITY>2</UPPER-MULTIPLICITY>'),
			'"C" occurs 3 times in this file; the definition allows 1..2.'
		);
		assert.strictEqual(
			message(
				1,
				'<LOWER-MULTIPLICITY>2</LOWER-MULTIPLICITY><UPPER-MULTIPLICITY-INFINITE>true</UPPER-MULTIPLICITY-INFINITE>'
			),
			'"C" occurs 1 times in this file; the definition allows 2..*.'
		);
		assert.strictEqual(
			message(
				2,
				'<LOWER-MULTIPLICITY>0</LOWER-MULTIPLICITY><UPPER-MULTIPLICITY>1</UPPER-MULTIPLICITY>',
				'(A==1)'
			),
			'"C" occurs 2 times under one condition in this file; the definition allows 0..1.'
		);
	});

	test('broken reference messages name the resolution reason', () => {
		const withReference = (target: string): string =>
			CLEAN.replace(
				'<VALUE>42</VALUE>',
				`<VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/Synthetic/SampleModuleDef/Main/PeerRef</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">${target}</VALUE-REF></ECUC-REFERENCE-VALUE><ECUC-NUMERICAL-PARAM-VALUE><VALUE>1</VALUE>`
			);
		const broken = (text: string): string[] =>
			validateWorkspace(workspace(text), DEFAULT_SEVERITIES).map((diagnostic) => diagnostic.message);

		assert.deepStrictEqual(broken(withReference('/No/Such/Target')), [
			'Reference target "/No/Such/Target" is not found in the workspace.',
		]);
		assert.deepStrictEqual(broken(withReference('')), ['Reference target "" is missing in the workspace.']);

		const ambiguous = CLEAN.replace(
			'</CONTAINERS>',
			'<ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/OtherDef/Main</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS>'
		).replace(
			'<VALUE>42</VALUE>',
			'<VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/Synthetic/SampleModuleDef/Main/PeerRef</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/Synthetic/SampleModule/Main</VALUE-REF></ECUC-REFERENCE-VALUE><ECUC-NUMERICAL-PARAM-VALUE><VALUE>1</VALUE>'
		);
		assert.ok(
			broken(ambiguous).includes('Reference target "/Synthetic/SampleModule/Main" is ambiguous in the workspace.')
		);

		const mismatch = withReference('/Synthetic/SampleModule/Main').replace(
			'<VALUE-REF DEST="ECUC-CONTAINER-VALUE">',
			'<VALUE-REF DEST="ECUC-MODULE-CONFIGURATION-VALUES">'
		);
		assert.ok(
			broken(mismatch).includes(
				'Reference target "/Synthetic/SampleModule/Main" is a container, not the declared DEST.'
			)
		);
	});

	test('missing definitions anchor at the highest missing non-module ancestor', () => {
		const values = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/D/M</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/X/Y/Z</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/X/Y/Z/W</DEFINITION-REF><VALUE>1</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const missing = validateWorkspace(workspace(values, '<AUTOSAR/>'), DEFAULT_SEVERITIES)
			.filter((diagnostic) => diagnostic.rule === 'missingDefinition')
			.map((diagnostic) => diagnostic.message);
		assert.deepStrictEqual(missing, [
			'Definition "/X/Y/Z" is not in the workspace index (2 instances).',
			'Definition "/D/M" is not in the workspace index (1 instance).',
		]);
	});

	test('a missing required reference is reported, a present one is not', () => {
		const definitions = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY><REFERENCES><ECUC-REFERENCE-DEF><SHORT-NAME>R</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY></ECUC-REFERENCE-DEF></REFERENCES></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const values = (reference: string): string =>
			`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF>${reference}</ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const missing = (reference: string): string[] =>
			validateWorkspace(workspace(values(reference), definitions), DEFAULT_SEVERITIES)
				.filter((diagnostic) => diagnostic.rule === 'missingRequired')
				.map((diagnostic) => diagnostic.message);

		assert.deepStrictEqual(missing(''), ['Missing required reference "R" (lower multiplicity 1).']);
		assert.deepStrictEqual(
			missing(
				'<REFERENCE-VALUES><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/MDef/C/R</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/P/M/C</VALUE-REF></ECUC-REFERENCE-VALUE></REFERENCE-VALUES>'
			),
			[]
		);
	});

	test('a duplicate message counts files and the override beats an off rule', () => {
		const sameFile = CLEAN.replace(
			'</CONTAINERS>',
			'<ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/SampleModuleDef/Main</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS>'
		);
		const duplicates = (index: WorkspaceIndex): string[] =>
			validateWorkspace(index, DEFAULT_SEVERITIES)
				.filter((diagnostic) => diagnostic.rule === 'duplicateShortName' && diagnostic.message.includes('/Synthetic/SampleModule/Main'))
				.map((diagnostic) => diagnostic.message);
		assert.deepStrictEqual(duplicates(workspace(sameFile)), [
			'SHORT-NAME "Main" is declared 2 times for /Synthetic/SampleModule/Main (1 file).',
		]);

		const cross = workspace(CLEAN);
		cross.upsert(buildFileIndex('file:///duplicate.arxml', CLEAN));
		assert.deepStrictEqual(duplicates(cross), [
			'SHORT-NAME "Main" is declared 2 times for /Synthetic/SampleModule/Main (2 files).',
		]);

		const off = validateWorkspace(cross, { ...DEFAULT_SEVERITIES, duplicateShortName: 'off' });
		assert.ok(
			off.some((diagnostic) => diagnostic.rule === 'duplicateShortName' && diagnostic.severity === 'information'),
			'the cross-file information override applies even when the rule is off'
		);
	});

	test('severity normalization rejects arrays, nulls and accepts every level', () => {
		assert.deepStrictEqual(normalizeSeverities([]), DEFAULT_SEVERITIES);
		assert.deepStrictEqual(normalizeSeverities(null), DEFAULT_SEVERITIES);
		assert.deepStrictEqual(normalizeSeverities(42), DEFAULT_SEVERITIES);
		assert.deepStrictEqual(normalizeSeverities({ multiplicity: 'information', missingRequired: 'off' }), {
			...DEFAULT_SEVERITIES,
			multiplicity: 'information',
			missingRequired: 'off',
		});
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
