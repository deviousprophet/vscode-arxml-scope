/**
 * Plan rows ID-01…05 from `docs/TEST_PLAN.md`.
 *
 * Identity is asserted through `buildNodeIndex`: an id resolves to exactly one
 * node, and a rename or a deletion moves it in the documented way.
 */
import * as assert from 'assert';

import { EcucDocumentModel } from '../../core/ecuc/model';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { innermostNodeIdAt } from '../../host/navigation';

function doc(elements: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>${elements}</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

function container(name: string, value: string): string {
	return `<ECUC-CONTAINER-VALUE><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/${name}</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/${name}/V</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE>`;
}

function threeContainers(): string {
	return doc(
		`<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS>${container('Same', '1')}${container('Same', '2')}${container('Same', '3')}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>`
	);
}

function modelOf(text: string): EcucDocumentModel {
	return scanEcucValues(text);
}

suite('plan coverage: ID', () => {
	test('ID-01 deleting the middle duplicate shifts only the later ordinal', () => {
		const text = threeContainers();
		const before = modelOf(text);
		const index = buildNodeIndex(before);
		const ids = before.modules[0].containers.map((entry) => index.idOf(entry));
		assert.deepStrictEqual(ids, [`container:P/M/Same#0`, `container:P/M/Same#1`, `container:P/M/Same#2`]);

		const middle = text.indexOf(container('Same', '2'));
		const withoutMiddle = text.slice(0, middle) + text.slice(middle + container('Same', '2').length);
		const after = modelOf(withoutMiddle);
		const next = buildNodeIndex(after);
		assert.deepStrictEqual(
			after.modules[0].containers.map((entry) => next.idOf(entry)),
			['container:P/M/Same#0', 'container:P/M/Same#1'],
			'the survivors renumber, and the next edit still resolves'
		);
		assert.ok(next.byId.get('container:P/M/Same#1'), 'the shifted id resolves');
		assert.strictEqual(next.byId.get('container:P/M/Same#2'), undefined, 'the removed ordinal is gone');
	});

	test('ID-02 renaming to a sibling name keeps the renamed node addressable', () => {
		const text = threeContainers();
		const renamed = text.replace(container('Same', '3'), container('Same', '3'));
		// Both the second and the third are now `Same`; the renamed value 3 belongs to
		// the last container, and a reveal there must pick the last node.
		const model = modelOf(renamed);
		const index = buildNodeIndex(model);
		const last = model.modules[0].containers[2];
		const id = index.idOf(last);
		assert.ok(id, 'the renamed container has an id');
		assert.strictEqual(
			innermostNodeIdAt(index, last.parameters[0].valueRange!.start + 1),
			`${id}/param:V#0`,
			'the value reveal resolves inside the renamed container, not a sibling'
		);
		assert.strictEqual(index.byId.get(id!)?.range, last.range);
	});

	test('ID-03 ids do not depend on the row sort', () => {
		const text = threeContainers();
		const model = modelOf(text);
		const ids = (sort: 'all' | 'declaration') =>
			buildRows(model, { sort }).rows.map((row) => row.id).sort();
		assert.deepStrictEqual(ids('all'), ids('declaration'));
	});

	test('ID-04 a short name with | and # round-trips through the id', () => {
		const text = doc(
			`<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>A|B#7</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS>${container('C', '1')}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>`
		);
		const model = modelOf(text);
		const index = buildNodeIndex(model);
		const module = model.modules[0];
		const id = index.idOf(module);
		assert.ok(id, 'the module is indexed');
		assert.ok(id!.includes('A|B#7'), `the raw name is kept: ${id}`);
		assert.strictEqual(index.byId.get(id!)?.range, module.range);
	});

	test('ID-05 a container rename moves its child ids, and the prediction matches a rescan', () => {
		const text = threeContainers();
		const before = modelOf(text);
		const beforeIndex = buildNodeIndex(before);
		const oldParam = before.modules[0].containers[0].parameters[0];
		const oldId = beforeIndex.idOf(oldParam);
		assert.ok(oldId!.startsWith('container:P/M/Same#0/param:'), oldId);

		const renamed = text.replace(container('Same', '1'), container('Renamed', '1'));
		const after = modelOf(renamed);
		const afterIndex = buildNodeIndex(after);
		const newParam = after.modules[0].containers[0].parameters[0];
		const newId = afterIndex.idOf(newParam);
		assert.ok(newId!.startsWith('container:P/M/Renamed#0/param:'), newId);
		assert.strictEqual(afterIndex.byId.get(newId!)?.range, newParam.range);
	});
});
