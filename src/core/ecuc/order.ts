/**
 * ECUC ordering: `sort all` plus the exception list (parent design §6, child design §2.4).
 *
 * The legacy key is `DEFINITION-REF + '"' + identity + '"'`, or `DEFINITION-REF`
 * alone for exception entries. Implemented as the tuple `(definitionRef, identity)`
 * with an empty identity for exception entries: equivalent, because `"` (U+0022)
 * sorts below every character legal in an AUTOSAR short-name or path.
 *
 * All functions are pure and return new arrays; sorting is per list and never
 * merges parameters with references.
 */
import { ContainerNode, ModuleNode, ParameterNode, ReferenceNode, SortMode } from './model';

/** The 15 entries hardcoded in the reference's `Arxml2Artext.cmd`, verbatim. */
export const SORT_EXCEPTIONS: readonly string[] = [
	'DcmDspDidRef',
	'DcmDspRequestRoutineResultsOutSignal',
	'DcmDspStartRoutineInSignal',
	'DcmDspStartRoutineOutSignal',
	'DcmDspStopRoutineInSignal',
	'DcmDspStopRoutineOutSignal',
	'DcmArgumentRef',
	'DemDidDataElementClassRef',
	'DemExtendedDataRecordClassRef',
	'DemDataElementClassRef',
	'DemDidClassRef',
	'DemFreezeFrameRecordClassRef',
	'DemSPNClassRef',
	'EcuMDriverInitItem',
	'EcuMRbCallOutItem',
];

type Keyed<T> = { item: T; definitionRef: string; identity: string };

function keyed<T>(
	items: readonly T[],
	except: ReadonlySet<string>,
	definitionRef: (item: T) => string,
	identity: (item: T) => string | undefined,
	exceptionTail: (item: T) => string
): Keyed<T>[] {
	return items.map((item) => {
		const ref = definitionRef(item);
		return {
			item,
			definitionRef: ref,
			// Exception entries use `(definitionRef, '')` so they keep declaration order.
			identity: except.has(exceptionTail(item)) ? '' : identity(item) ?? '',
		};
	});
}

function compareKeys(a: Keyed<unknown>, b: Keyed<unknown>): number {
	if (a.definitionRef < b.definitionRef) {
		return -1;
	}
	if (a.definitionRef > b.definitionRef) {
		return 1;
	}
	if (a.identity < b.identity) {
		return -1;
	}
	if (a.identity > b.identity) {
		return 1;
	}
	return 0;
}

/** Stable sort by `(definitionRef, identity)`; `Array.prototype.sort` is stable per ES2019. */
function sortKeyed<T>(items: Keyed<T>[]): T[] {
	return items.sort(compareKeys).map((k) => k.item);
}

/** Orders modules; `declaration` returns the authored order. */
export function orderModules(
	modules: readonly ModuleNode[],
	mode: SortMode,
	except: readonly string[] = SORT_EXCEPTIONS
): ModuleNode[] {
	if (mode === 'declaration') {
		return modules.slice();
	}
	const set = new Set(except);
	return sortKeyed(
		keyed(
			modules,
			set,
			(m) => m.definitionRef,
			(m) => m.shortName,
			(m) => tailOf(m.definitionRef)
		)
	);
}

/** Orders containers; `declaration` returns the authored order. */
export function orderContainers(
	containers: readonly ContainerNode[],
	mode: SortMode,
	except: readonly string[] = SORT_EXCEPTIONS
): ContainerNode[] {
	if (mode === 'declaration') {
		return containers.slice();
	}
	const set = new Set(except);
	return sortKeyed(
		keyed(
			containers,
			set,
			(c) => c.definitionRef,
			(c) => c.shortName,
			(c) => tailOf(c.definitionRef)
		)
	);
}

/** Orders parameters and references independently, so the two lists never interleave. */
export function orderMembers(
	parameters: readonly ParameterNode[],
	references: readonly ReferenceNode[],
	mode: SortMode,
	except: readonly string[] = SORT_EXCEPTIONS
): { parameters: ParameterNode[]; references: ReferenceNode[] } {
	if (mode === 'declaration') {
		return { parameters: parameters.slice(), references: references.slice() };
	}
	const set = new Set(except);
	return {
		parameters: sortKeyed(
			keyed(
				parameters,
				set,
				(p) => p.definitionRef,
				(p) => p.displayValue,
				(p) => tailOf(p.definitionRef)
			)
		),
		references: sortKeyed(
			keyed(
				references,
				set,
				(r) => r.definitionRef,
				referenceIdentity,
				(r) => tailOf(r.definitionRef)
			)
		),
	};
}

/**
 * Sort identity of a reference: the legacy `child[?VALUE-REF | ?VALUE-IREF].data`.
 * For an instance reference that is the `TARGET-REF` text followed by the
 * `CONTEXT-ELEMENT-REF` texts, concatenated in document order with no separator —
 * so two instance references with the same target but different contexts order by
 * context. Inter-element whitespace inside `VALUE-IREF` is ignored, which makes
 * this a documented approximation of `.data` rather than a byte-exact
 * reproduction (parent D6).
 */
function referenceIdentity(r: ReferenceNode): string {
	return (r.targetRawPath ?? '') + r.contextPaths.join('');
}

/** `DEFINITION-REF` tail, the legacy `\lastShortName`. */
function tailOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? path : path.slice(i + 1);
}
