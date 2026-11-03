import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { EcucRow, buildRows } from '../../core/ecuc/renderRows';

const TEXT = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>
<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><CONTAINERS>
<ECUC-CONTAINER-VALUE><SHORT-NAME>Holder</SHORT-NAME><REFERENCE-VALUES>
<ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/M/Def/Ref</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/P/Other/Remote</VALUE-REF></ECUC-REFERENCE-VALUE>
</REFERENCE-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>
</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;

function referenceRow(rows: readonly EcucRow[]): EcucRow {
	const found = rows.find((candidate) => candidate.kind === 'reference');
	assert.ok(found, 'the reference row is present');
	return found;
}

suite('cross-file reference rows (core)', () => {
	test('the workspace resolver makes a reference followable when the target is in another file', () => {
		const model = scanEcucValues(TEXT);
		const without = referenceRow(buildRows(model).rows);
		assert.strictEqual(without.followable, false, 'the same-file index has no target');

		const withResolver = referenceRow(
			buildRows(model, {
				referenceResolver: (path, dest) =>
					path === '/P/Other/Remote' && dest === 'ECUC-CONTAINER-VALUE'
						? { followable: true }
						: { followable: false, reason: 'No target.' },
			}).rows
		);
		assert.strictEqual(withResolver.followable, true);
		assert.strictEqual(withResolver.followReason, undefined);
	});

	test('a refused target stays not followable and carries the reason', () => {
		const model = scanEcucValues(TEXT);
		const row = referenceRow(buildRows(model, { referenceResolver: () => ({ followable: false, reason: 'No target.' }) }).rows);
		assert.strictEqual(row.followable, false);
		assert.strictEqual(row.followReason, 'No target.');
	});
});
