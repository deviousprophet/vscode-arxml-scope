/**
 * Plan rows ROW-06 and ROW-08 from `docs/TEST_PLAN.md`: the annotation shapes
 * that produce a comment line, and the exception list matching only a
 * `DEFINITION-REF` tail inside a longer path.
 */
import * as assert from 'assert';

import { ParameterNode } from '../../core/ecuc/model';
import { SORT_EXCEPTIONS, orderMembers } from '../../core/ecuc/order';
import { EcucRow, buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';

function doc(elements: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>${elements}</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

function annotated(name: string, annotation: string): string {
	return `<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/${name}</DEFINITION-REF><ANNOTATIONS>${annotation}</ANNOTATIONS><VALUE>1</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
}

function annotatedDocument(): string {
	return doc(
		`<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/C</DEFINITION-REF><PARAMETER-VALUES>${annotated(
			'LabelOnly',
			'<ANNOTATION><LABEL><L-4>Note</L-4></LABEL></ANNOTATION>'
		)}${annotated(
			'TextOnly',
			'<ANNOTATION><ANNOTATION-TEXT><VERBATIM><L-5>body only</L-5></VERBATIM></ANNOTATION-TEXT></ANNOTATION>'
		)}${annotated(
			'Neither',
			'<ANNOTATION><LABEL><L-4></L-4></LABEL><ANNOTATION-TEXT><VERBATIM><L-5></L-5></VERBATIM></ANNOTATION-TEXT></ANNOTATION>'
		)}</PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>`
	);
}

function rowsOf(text: string): EcucRow[] {
	return buildRows(scanEcucValues(text), { sort: 'all' }).rows;
}

/** Minimal parameter node: only the fields the ordering reads are meaningful. */
function parameter(definitionRef: string, value: string): ParameterNode {
	return {
		kind: 'parameter',
		numeric: true,
		definitionRef,
		name: definitionRef.slice(definitionRef.lastIndexOf('/') + 1),
		displayValue: value,
		range: { start: 0, end: 0 },
	};
}

suite('plan coverage: ROW extras', () => {
	test('ROW-06 label-only, text-only and empty annotations produce the matching comment lines', () => {
		const rows = rowsOf(annotatedDocument());
		const labelOnly = rows.find((row) => row.label === 'LabelOnly')!;
		const textOnly = rows.find((row) => row.label === 'TextOnly')!;
		const neither = rows.find((row) => row.label === 'Neither')!;

		assert.deepStrictEqual(labelOnly.comments, ['[Note] '], 'a label alone keeps the documented separator');
		assert.deepStrictEqual(textOnly.comments, ['body only'], 'text alone is the comment without a label prefix');
		assert.strictEqual(neither.comments, undefined, 'an annotation without label or text adds no comment line');

		assert.deepStrictEqual(
			labelOnly.meta.filter((part) => part.cls === 'annotation').map((part) => part.text),
			['[Note] ']
		);
		assert.deepStrictEqual(
			textOnly.meta.filter((part) => part.cls === 'annotation').map((part) => part.text),
			['body only']
		);
		assert.strictEqual(
			neither.meta.filter((part) => part.cls === 'annotation').length,
			0,
			'a blank annotation contributes no meta chip'
		);
	});

	test('ROW-08 a sortExcept tail inside a longer DEFINITION-REF keeps declaration order', () => {
		// Both exception rows share a long path whose last segment is in the
		// exception list; the list matches the tail, never the full path.
		const authored = [
			parameter('/PkgA/Mod/Sub/DcmDspDidRef', 'z'),
			parameter('/PkgA/Mod/Sub/DcmDspDidRef', 'a'),
			parameter('/PkgA/Mod/Sub/Other', 'a'),
		];
		const names = (nodes: ParameterNode[]): string[] =>
			nodes.map((node) => `${node.name}=${node.displayValue}`);

		assert.deepStrictEqual(
			names(orderMembers(authored, [], 'all', []).parameters),
			['DcmDspDidRef=a', 'DcmDspDidRef=z', 'Other=a'],
			'without the exception the value sorts the two DcmDspDidRef rows'
		);
		assert.deepStrictEqual(
			names(orderMembers(authored, [], 'all', SORT_EXCEPTIONS).parameters),
			['DcmDspDidRef=z', 'DcmDspDidRef=a', 'Other=a'],
			'the exception applies by the nested tail and keeps declaration order'
		);
	});
});
