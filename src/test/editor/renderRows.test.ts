/**
 * Task design §2 — the host row model is the single source of the display
 * order, meta/value/target fields, source positions and search haystacks.
 *
 * The assertions are on values, not markup: a row must not carry HTML, the
 * display order must match the existing order/meta rules (including the
 * `sort all` exceptions), and `parentId`/`subtreeSize`/posinset must be
 * internally consistent for the page's collapse and ancestor passes.
 */
import * as assert from 'assert';

import { ContainerNode, EcucDocumentModel, ModuleNode, ParameterNode, ReferenceNode } from '../../core/ecuc/model';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { LineIndex } from '../../core/text/offsets';
import { buildRows } from '../../editor/renderRows';
import { fixtureText } from '../core/modelTestUtils';

const FIXTURE = 'editor/render.arxml';

function fixtureRows(): ReturnType<typeof buildRows> {
	const text = fixtureText(FIXTURE);
	return buildRows(scanEcucValues(text), { lineIndex: new LineIndex(text) });
}

suite('editor row model (design §2)', () => {
	test('design §2: rows are in display order with levels and contiguous subtrees', () => {
		const doc = fixtureRows();
		assert.deepStrictEqual(
			doc.rows.map((row) => `${row.label}@${row.level}`),
			[
				'PkgA.PkgB.ModDefs.ModX@1',
				'ContA@2',
				'Flag@3',
				'IniValue@3',
				'Title@3',
				'PeerIref@3',
				'PeerRef@3',
				'ContB@3',
				'Text@4',
			],
			'sorted DEFS, parameters before references before child containers'
		);
		assert.deepStrictEqual(
			doc.rows.map((row) => row.subtreeSize),
			[8, 7, 0, 0, 0, 0, 0, 1, 0],
			'descendants are contiguous after their parent'
		);
		assert.deepStrictEqual(
			doc.rows.map((row) => row.hasChildren),
			[true, true, false, false, false, false, false, true, false]
		);

		assert.strictEqual(doc.rows[0].parentId, null, 'a module has no parent');
		for (const row of doc.rows.slice(1)) {
			assert.ok(row.parentId !== null, `${row.label} has a parent id`);
		}
		const byId = new Map(doc.rows.map((row) => [row.id, row]));
		for (const row of doc.rows) {
			if (row.parentId === null) {
				continue;
			}
			const parent = byId.get(row.parentId);
			assert.ok(parent, `${row.label}'s parent exists in the row set`);
			assert.strictEqual(row.level, parent.level + 1, `${row.label}'s level follows its parent`);
		}
	});

	test('design §2: posinset/setsize use the same contiguous group as the renderer', () => {
		const doc = fixtureRows();
		const byLabel = (label: string) => {
			const row = doc.rows.find((candidate) => candidate.label === label);
			assert.ok(row, label);
			return row;
		};
		assert.deepStrictEqual(
			{ pos: byLabel('PkgA.PkgB.ModDefs.ModX').posinset, size: byLabel('PkgA.PkgB.ModDefs.ModX').setsize },
			{ pos: 1, size: 1 }
		);
		const contA = byLabel('ContA');
		assert.deepStrictEqual({ pos: contA.posinset, size: contA.setsize }, { pos: 1, size: 1 });
		assert.deepStrictEqual(
			doc.rows.filter((row) => row.parentId === contA.id).map((row) => [row.label, row.posinset, row.setsize]),
			[
				['Flag', 1, 6],
				['IniValue', 2, 6],
				['Title', 3, 6],
				['PeerIref', 4, 6],
				['PeerRef', 5, 6],
				['ContB', 6, 6],
			],
			'parameters, then references, then child containers'
		);
		assert.deepStrictEqual(
			{ pos: byLabel('ContB').posinset, size: byLabel('ContB').setsize },
			{ pos: 6, size: 6 },
			'the nested container is the sixth child of ContA'
		);
	});

	test('design §2: labels, values, targets, context and meta parts are values', () => {
		const doc = fixtureRows();
		const byLabel = (label: string) => {
			const row = doc.rows.find((candidate) => candidate.label === label);
			assert.ok(row, label);
			return row;
		};

		const moduleRow = byLabel('PkgA.PkgB.ModDefs.ModX');
		assert.strictEqual(moduleRow.shortName, 'ModX');
		assert.strictEqual(moduleRow.title, '/PkgA/PkgB/ModDefs/ModX');
		assert.deepStrictEqual(moduleRow.meta.map((part) => `${part.cls}:${part.text}`), [
			'short:"ModX"',
			'variant:(VariantPreCompile)',
			'condition:[(A == B)]',
			'condition:<Crit1 == 1 && Crit2 == 2>',
			'annotation:[Note] module note',
		]);

		const contA = byLabel('ContA');
		assert.strictEqual(contA.definitionRef, '/PkgA/PkgB/ModDefs/ModX/ContA');
		assert.deepStrictEqual(contA.meta.map((part) => `${part.cls}:${part.text}`), [
			'short:"ContA"',
			'annotation:container note',
		]);

		const ini = byLabel('IniValue');
		assert.strictEqual(ini.value, '63');
		assert.strictEqual(ini.valueKind, 'numeric');
		assert.strictEqual(ini.shownValue, '63');
		assert.deepStrictEqual(ini.meta.map((part) => `${part.cls}:${part.text}`), ['hex:(= 0x3F)']);

		const title = byLabel('Title');
		assert.strictEqual(title.valueKind, 'textual');
		assert.strictEqual(title.shownValue, '"hello"', 'a textual value is quoted');

		const flag = byLabel('Flag');
		assert.strictEqual(flag.valueKind, 'boolean');
		assert.strictEqual(flag.shownValue, 'true', 'a boolean value is left bare');

		const peer = byLabel('PeerIref');
		assert.strictEqual(peer.value, 'PkgA.PkgB.ModX.ContA.ContB', 'the dotted target is displayed');
		assert.strictEqual(peer.shownValue, 'PkgA.PkgB.ModX.ContA.ContB');
		assert.strictEqual(peer.target, '/PkgA/PkgB/ModX/ContA/ContB', 'the raw target is kept for follow');
		assert.deepStrictEqual(peer.contextPaths, ['PkgA.PkgB.ModX.ContA']);
		assert.deepStrictEqual(peer.meta.map((part) => `${part.cls}:${part.text}`), [
			'context:context PkgA.PkgB.ModX.ContA',
		]);
	});

	test('design §2: haystacks are lower-cased label + short name + value', () => {
		const doc = fixtureRows();
		const byLabel = (label: string) => doc.rows.find((row) => row.label === label)?.haystack;
		assert.strictEqual(byLabel('PkgA.PkgB.ModDefs.ModX'), 'pkga.pkgb.moddefs.modx modx');
		assert.strictEqual(byLabel('ContA'), 'conta conta');
		assert.strictEqual(byLabel('IniValue'), 'inivalue 63');
		assert.strictEqual(byLabel('Title'), 'title hello');
		assert.strictEqual(byLabel('PeerRef'), 'peerref pkga.pkgb.modx.conta.contb');
	});

	test('design §2: source lines are 1-based and inspector positions are 0-based', () => {
		const doc = fixtureRows();
		const ini = doc.rows.find((row) => row.label === 'IniValue');
		assert.ok(ini);
		assert.strictEqual(ini.sourceLine, 54, 'the ECUC-NUMERICAL-PARAM-VALUE line (1-based)');
		assert.strictEqual(ini.line, 53, 'the inspector line is 0-based');
		assert.strictEqual(ini.column, 40);
		assert.strictEqual(ini.endLine, 56);
		assert.strictEqual(ini.endColumn, 69);
		assert.strictEqual(doc.digits, 2, 'the widest source line has two digits');
	});

	test('design §2: without a line index the row is well formed and digit width is 1', () => {
		const doc = buildRows(scanEcucValues(fixtureText(FIXTURE)));
		assert.strictEqual(doc.digits, 1);
		for (const row of doc.rows) {
			assert.strictEqual(row.sourceLine, 0);
			assert.strictEqual(row.line, 0);
			assert.strictEqual(row.column, 0);
			assert.strictEqual(row.endLine, 0);
			assert.strictEqual(row.endColumn, 0);
		}
	});

	test('design §2: a hand-authored source maps start and end without a display guess', () => {
		const lines = [
			'<AUTOSAR>',
			'  <AR-PACKAGES>',
			'    <AR-PACKAGE>',
			'      <SHORT-NAME>P</SHORT-NAME>',
			'      <ELEMENTS>',
			'        <ECUC-MODULE-CONFIGURATION-VALUES>',
			'          <SHORT-NAME>M</SHORT-NAME>',
			'          <DEFINITION-REF>/D/M</DEFINITION-REF>',
			'          <CONTAINERS>',
			'            <ECUC-CONTAINER-VALUE>',
			'              <SHORT-NAME>C</SHORT-NAME>',
			'              <DEFINITION-REF>/D/C</DEFINITION-REF>',
			'              <PARAMETER-VALUES>',
			'                <ECUC-NUMERICAL-PARAM-VALUE>',
			'                  <DEFINITION-REF>/D/C/P</DEFINITION-REF>',
			'                  <VALUE>1</VALUE>',
			'                </ECUC-NUMERICAL-PARAM-VALUE>',
			'              </PARAMETER-VALUES>',
			'            </ECUC-CONTAINER-VALUE>',
			'          </CONTAINERS>',
			'        </ECUC-MODULE-CONFIGURATION-VALUES>',
			'      </ELEMENTS>',
			'    </AR-PACKAGE>',
			'  </AR-PACKAGES>',
			'</AUTOSAR>',
		];
		const text = lines.join('\n');
		const doc = buildRows(scanEcucValues(text), { lineIndex: new LineIndex(text) });
		const row = doc.rows.find((candidate) => candidate.label === 'P');
		assert.ok(row, 'the parameter row exists');
		const start = lines.findIndex((line) => line.includes('<ECUC-NUMERICAL-PARAM-VALUE>'));
		const end = lines.findIndex((line) => line.includes('</ECUC-NUMERICAL-PARAM-VALUE>'));
		assert.strictEqual(row.sourceLine, start + 1);
		assert.strictEqual(row.line, start);
		assert.strictEqual(row.column, lines[start].indexOf('<'));
		assert.strictEqual(row.endLine, end);
		assert.strictEqual(row.endColumn, lines[end].indexOf('</') + '</ECUC-NUMERICAL-PARAM-VALUE>'.length);
		assert.strictEqual(doc.digits, 2);
	});

	test('design §2: sort all uses the exception list, declaration keeps the authored order', () => {
		const model = scanEcucValues(fixtureText('exceptions.arxml'));
		assert.deepStrictEqual(
			buildRows(model).rows.map((row) => row.label),
			['D.M', 'C', 'Alpha', 'Beta', 'DcmDspDidRef', 'DcmDspDidRef', 'DemDidClassRef', 'Zeta'],
			'exceptions keep declaration order among themselves'
		);
		assert.deepStrictEqual(
			buildRows(model, { sort: 'declaration' }).rows.map((row) => row.label),
			['D.M', 'C', 'Zeta', 'DcmDspDidRef', 'Alpha', 'DemDidClassRef', 'DcmDspDidRef', 'Beta']
		);
	});

	test('design §2: ids keep the declaration-order ordinal when the display order changes', () => {
		const model = scanEcucValues(fixtureText('editor/sibling-sort-order.arxml'));
		const sorted = buildRows(model).rows;
		const declared = buildRows(model, { sort: 'declaration' }).rows;
		const zetaSorted = sorted.find((row) => row.label === 'Zeta');
		const zetaDeclared = declared.find((row) => row.label === 'Zeta');
		assert.ok(zetaSorted && zetaDeclared);
		assert.strictEqual(zetaSorted.id, zetaDeclared.id, 'the id is stable across a sort re-scan');
		assert.notStrictEqual(
			sorted.find((row) => row.label === 'Alpha')?.id,
			zetaSorted.id,
			'two same-named siblings get distinct ids'
		);
	});

	test('design §2: deep nesting keeps the contiguous subtree invariant', () => {
		const rows = buildRows(scanEcucValues(fixtureText('deep.arxml'))).rows;
		assert.deepStrictEqual(
			rows.map((row) => row.level),
			[1, 2, 3, 4, 5, 6, 7]
		);
		assert.deepStrictEqual(
			rows.map((row) => row.subtreeSize),
			[6, 5, 4, 3, 2, 1, 0]
		);
	});

	test('design §2: a large synthetic model builds in DFS order without HTML', () => {
		const modules: ModuleNode[] = [];
		const CONTAINERS_PER_MODULE = 10;
		const PARAMETERS_PER_CONTAINER = 5;
		const NESTED_PER_CONTAINER = 2;
		const PARAMETERS_PER_NESTED = 3;
		for (let m = 0; m < 80; m++) {
			const containers: ContainerNode[] = [];
			for (let c = 0; c < CONTAINERS_PER_MODULE; c++) {
				const parameters: ParameterNode[] = [];
				for (let p = 0; p < PARAMETERS_PER_CONTAINER; p++) {
					parameters.push(syntheticParameter(`/D/M${m}/C${c}/P${p}`, String(p)));
				}
				const nested: ContainerNode[] = [];
				for (let n = 0; n < NESTED_PER_CONTAINER; n++) {
					const nestedParameters: ParameterNode[] = [];
					for (let p = 0; p < PARAMETERS_PER_NESTED; p++) {
						nestedParameters.push(syntheticParameter(`/D/M${m}/C${c}/N${n}/P${p}`, String(p)));
					}
					nested.push(syntheticContainer(`N${n}`, `/D/M${m}/C${c}/N${n}`, nestedParameters));
				}
				containers.push(syntheticContainer(`C${c}`, `/D/M${m}/C${c}`, parameters, nested));
			}
			modules.push(syntheticModule(`M${m}`, `/D/M${m}`, containers));
		}
		const model: EcucDocumentModel = { packages: [], modules, pathIndex: new Map() };
		const doc = buildRows(model);
		const expected = modules.length * (1 + CONTAINERS_PER_MODULE * (1 + PARAMETERS_PER_CONTAINER + NESTED_PER_CONTAINER * (1 + PARAMETERS_PER_NESTED)));
		assert.strictEqual(doc.rows.length, expected, 'every module/container/parameter is a row');
		assert.ok(doc.rows.length > 10000, 'the synthetic set is huge-file sized');

		const lastIndex = doc.rows.length - 1;
		for (let i = 0; i <= lastIndex; i++) {
			const row = doc.rows[i];
			const end = i + row.subtreeSize;
			assert.ok(end <= lastIndex, `${row.label}'s subtree fits in the row set`);
			assert.strictEqual(row.hasChildren, row.subtreeSize > 0, `${row.label}'s hasChildren agrees with subtreeSize`);
			assert.strictEqual(row.posinset >= 1 && row.posinset <= row.setsize, true, row.label);
			for (let child = i + 1; child <= end; child++) {
				assert.ok(doc.rows[child].level > row.level, `${row.label}'s subtree only contains deeper rows`);
			}
			if (end < lastIndex) {
				assert.ok(doc.rows[end + 1].level <= row.level, `${row.label}'s subtree is contiguous`);
			}
		}
		assert.ok(!JSON.stringify(doc).includes('<span'), 'the row data carries no markup');
	});
});

function syntheticParameter(definitionRef: string, value: string): ParameterNode {
	return {
		kind: 'parameter',
		numeric: true,
		definitionRef,
		name: definitionRef.slice(definitionRef.lastIndexOf('/') + 1),
		displayValue: value,
		range: { start: 0, end: 0 },
	};
}

function syntheticContainer(
	shortName: string,
	definitionRef: string,
	parameters: ParameterNode[],
	containers: ContainerNode[] = []
): ContainerNode {
	return {
		kind: 'container',
		definitionRef,
		shortName,
		range: { start: 0, end: 0 },
		containerPath: [],
		parameters,
		references: [] as ReferenceNode[],
		containers,
	};
}

function syntheticModule(shortName: string, definitionRef: string, containers: ContainerNode[]): ModuleNode {
	return {
		kind: 'module',
		definitionRef,
		shortName,
		range: { start: 0, end: 0 },
		containers,
	};
}
