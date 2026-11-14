/**
 * Builders for merge-planner tests: small hand-written trees with explicit digests.
 *
 * Test-only. Digests are arbitrary strings here because the planner only compares
 * them; the real digests are computed by the engine and exercised by the extension
 * merge test against real ARXML text.
 */
import type { EcucRow } from '../../core/ecuc/renderRows';
import type { MergeDoc, MergeNode } from '../../core/merge/model';

export interface NodeSpec {
	id: string;
	kind: 'module' | 'container' | 'parameter' | 'reference';
	parentId: string | null;
	order: number;
	digest: string;
	shortName?: string;
}

function levelOf(kind: NodeSpec['kind']): number {
	if (kind === 'module') {
		return 1;
	}
	return kind === 'container' ? 2 : 3;
}

function rowOf(node: MergeNode): EcucRow {
	const label = node.path.split('/').pop() ?? node.path;
	const parentId = node.parentId;
	return {
		id: node.id,
		kind: node.kind as EcucRow['kind'],
		level: levelOf(node.kind as NodeSpec['kind']),
		parentId,
		subtreeSize: 0,
		posinset: 1,
		setsize: 1,
		hasChildren: node.kind === 'module' || node.kind === 'container',
		label,
		shortName: node.kind === 'container' ? label : undefined,
		definitionRef: node.path,
		title: node.path,
		meta: [],
		haystack: label.toLowerCase(),
		...(node.kind === 'parameter' ? { value: node.ownDigest, shownValue: node.ownDigest } : {})
	};
}

/** One side of a merge, from hand-written specs. */
export function mergeDoc(name: string, specs: readonly NodeSpec[], text = ''): MergeDoc {
	const nodes: MergeNode[] = specs.map((spec, index) => ({
		id: spec.id,
		kind: spec.kind,
		path: spec.shortName ?? spec.id,
		parentId: spec.parentId,
		order: spec.order,
		range: { start: index * 100, end: index * 100 + 50 },
		ownDigest: spec.digest
	}));
	return { uri: name, text, nodes, rows: nodes.map(rowOf) };
}

/** A module with one container and the given parameters; each change is a digest. */
export function moduleTree(moduleDigest: string, containerDigest: string, parameters: Record<string, string>): NodeSpec[] {
	const moduleId = 'module:/Pkg/Mod|Mod#0';
	const containerId = 'container:Pkg/Mod/Cont#0';
	const specs: NodeSpec[] = [
		{ id: moduleId, kind: 'module', parentId: null, order: 0, digest: moduleDigest },
		{ id: containerId, kind: 'container', parentId: moduleId, order: 0, digest: containerDigest, shortName: 'Cont' }
	];
	let order = 0;
	for (const [name, digest] of Object.entries(parameters)) {
		specs.push({
			id: `${containerId}/param:${name}#0`,
			kind: 'parameter',
			parentId: containerId,
			order: order++,
			digest
		});
	}
	return specs;
}
