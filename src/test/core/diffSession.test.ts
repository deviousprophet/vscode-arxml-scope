import * as assert from 'assert';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildRows } from '../../core/ecuc/renderRows';
import { DiffPreparedSide, DiffSession } from './diffSessionOracle';

const LEFT = { name: 'left.arxml', path: '/work/left.arxml' };
const RIGHT = { name: 'right.arxml', path: '/work/right.arxml' };

function container(name: string, definitionRef: string, value = '1'): string {
	return `<ECUC-CONTAINER-VALUE><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">${definitionRef}</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">${definitionRef}/Value</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE>`;
}

function moduleWith(containerXml: string): string {
	return `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M1</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M1</DEFINITION-REF><CONTAINERS>${containerXml}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

function prepared(text: string): DiffPreparedSide {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	const rows = buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
	return {
		rows,
		rangeOf: (id) => index.byId.get(id)?.range,
		header: { schema: model.schema ? model.schema.release : undefined, packages: model.packages.map((pkg) => pkg.path.join('.')) },
	};
}

function session(leftText: string, rightText: string): DiffSession {
	return new DiffSession(LEFT, RIGHT, prepared(leftText), prepared(rightText));
}

const SAME = moduleWith(container('NMH_MO_01_MAIN_BUS', '/P/MainBus'));
const RENAMED = moduleWith(container('NM_MO_01_MAIN_BUS', '/P/MainBus'));

suite('diff session (core)', () => {
	test('a semantic build with no rename is reused for strict', () => {
		const diff = session(SAME, SAME);
		const semantic = diff.document(true);
		assert.strictEqual(semantic.changed, true);
		assert.strictEqual(semantic.document.summary.renamed, 0);

		const strict = diff.document(false);
		assert.strictEqual(strict.changed, false);
		assert.strictEqual(strict.document, semantic.document);

		const again = diff.document(true);
		assert.strictEqual(again.changed, false);
		assert.strictEqual(again.document, semantic.document);
	});

	test('an initial strict build is not proof that semantic is identical', () => {
		const diff = session(SAME, RENAMED);
		const strict = diff.document(false);
		assert.strictEqual(strict.document.summary.renamed, 0);

		const semantic = diff.document(true);
		assert.strictEqual(semantic.changed, true);
		assert.notStrictEqual(semantic.document, strict.document);
		assert.strictEqual(semantic.document.summary.renamed, 1);
	});

	test('a renamed pair caches each mode and switches between the cached objects', () => {
		const diff = session(SAME, RENAMED);
		const semantic = diff.document(true).document;
		const strict = diff.document(false).document;
		assert.notStrictEqual(strict, semantic);

		assert.strictEqual(diff.document(true).document, semantic);
		assert.strictEqual(diff.document(false).document, strict);
	});

	test('invalidate drops the cached documents', () => {
		const diff = session(SAME, SAME);
		const first = diff.document(true).document;
		diff.invalidate();
		const second = diff.document(true);
		assert.notStrictEqual(second.document, first);
		assert.strictEqual(second.changed, true);
	});
});
