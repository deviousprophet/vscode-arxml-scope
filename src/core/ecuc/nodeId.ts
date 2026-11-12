/**
 * Path-based node ids.
 *
 * An id is derived from the node's own path — the container short-name chain, the
 * `DEFINITION-REF`, the `DEFINITION-REF` tail — and never from an array index, so it
 * survives a re-scan that reorders nodes. Siblings that share a tail are told apart
 * by a declaration-order ordinal, which is why the index is built from the raw model
 * rather than from the display-ordered view: toggling the sort setting cannot
 * renumber a node.
 *
 * Every kind carries that ordinal. Containers and modules used to be identified by
 * their path alone, so two sibling containers sharing a `SHORT-NAME` shared one id and
 * a reveal could land on the wrong one; parameters and
 * references already had the ordinal. The ordinal is a counter over the raw model's
 * document order — the same source the rest of the id uses — and is never taken from
 * the display order.
 */
import {
	ContainerNode,
	EcucDocumentModel,
	ModuleNode,
	ParameterNode,
	Range,
	ReferenceNode,
} from './model';

export type EcucNode = ModuleNode | ContainerNode | ParameterNode | ReferenceNode;
export type EcucNodeKind = EcucNode['kind'];

export interface NodeEntry {
	id: string;
	kind: EcucNodeKind;
	/** The node's primary label, for notices. */
	label: string;
	/** The AR path for a module/container, when the model indexed one. */
	path?: string;
	range: Range;
	node: EcucNode;
}

export interface NodeIndex {
	byId: Map<string, NodeEntry>;
	/** Entries ordered by range start, for the innermost-node lookup. */
	sorted: NodeEntry[];
	/** The id this index assigned to a node of the model it was built from. */
	idOf(node: EcucNode): string | undefined;
}

/** Indexes every node of a model by its path-based id. */
export function buildNodeIndex(model: EcucDocumentModel): NodeIndex {
	const byId = new Map<string, NodeEntry>();
	const ids = new WeakMap<EcucNode, string>();
	const ordinals = new Map<string, number>();
	const pathByRange = pathRangesOf(model.pathIndex);

	const add = (node: EcucNode, id: string, label: string, range: Range): void => {
		const path = pathByRange.get(`${range.start}:${range.end}`);
		byId.set(id, { id, kind: node.kind, label, ...(path === undefined ? {} : { path }), range, node });
		ids.set(node, id);
	};

	const ordinal = (owner: string, kind: string, name: string): number => {
		const key = `${owner}|${kind}|${name}`;
		const next = ordinals.get(key) ?? 0;
		ordinals.set(key, next + 1);
		return next;
	};

	const visitContainer = (container: ContainerNode): void => {
		// The owner is the container's path — identical for siblings — so the ordinal
		// separates two siblings that share a short-name.
		const owner = container.containerPath.join('/');
		const id = `container:${owner}/${container.shortName}#${ordinal(owner, 'container', container.shortName)}`;
		add(container, id, container.shortName, container.range);
		for (const parameter of container.parameters) {
			add(parameter, `${id}/param:${parameter.name}#${ordinal(id, 'param', parameter.name)}`, parameter.name, parameter.range);
		}
		for (const reference of container.references) {
			add(reference, `${id}/ref:${reference.name}#${ordinal(id, 'ref', reference.name)}`, reference.name, reference.range);
		}
		for (const child of container.containers) {
			visitContainer(child);
		}
	};

	for (const module of model.modules) {
		const id = moduleId(module, ordinal);
		add(module, id, module.shortName, module.range);
		for (const container of module.containers) {
			visitContainer(container);
		}
	}

	return {
		byId,
		sorted: sortedEntries(byId),
		idOf: (node) => ids.get(node),
	};
}

/** First path that indexed a range; later duplicate ranges are ignored. */
function pathRangesOf(pathIndex: Map<string, Range>): Map<string, string> {
	const pathByRange = new Map<string, string>();
	for (const [path, range] of pathIndex) {
		const key = `${range.start}:${range.end}`;
		if (!pathByRange.has(key)) {
			pathByRange.set(key, path);
		}
	}
	return pathByRange;
}

/** The module's id: its definition and short name, plus a declaration ordinal. */
function moduleId(module: ModuleNode, ordinal: (owner: string, kind: string, name: string) => number): string {
	const name = `${module.definitionRef}|${module.shortName}`;
	return `module:${name}#${ordinal('', 'module', name)}`;
}

/** Entries by range start, then the widest range first. */
function sortedEntries(byId: Map<string, NodeEntry>): NodeEntry[] {
	return [...byId.values()].sort(
		(a, b) => a.range.start - b.range.start || b.range.end - a.range.end
	);
}
