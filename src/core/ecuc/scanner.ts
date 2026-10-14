/**
 * Single-pass, iterative ECUC-Values scanner (parent design §5, child design §1–§2).
 *
 * Hand-written lexer plus an element stack. No DOM, no recursion: nesting depth
 * cannot overflow the call stack. The returned model holds only strings, numbers
 * and ranges, so it retains no reference to the input string.
 *
 * Implemented against `research/legacy-artext-analysis.md` §2 and parent design §4–§8.
 */
import { ContainerNode, EcucDocumentModel, ModuleNode, ParameterNode, Range, ReferenceNode, lastShortName } from './model';

type RecKind =
	| 'autosar'
	| 'package'
	| 'module'
	| 'container'
	| 'param'
	| 'reference'
	| 'text'
	| 'value'
	| 'pbConditions'
	| 'pbCondition'
	| 'annotations'
	| 'annotation';

/** Accumulating record for an element the model cares about. */
interface Rec {
	kind: RecKind;
	name: string;
	range?: Range;
	attrs?: Map<string, string>;
	definitionRef?: string;
	definitionRefRange?: Range;
	shortName?: string;
	shortNameRange?: Range;
	variant?: string;
	variantRange?: Range;
	containerPath?: string[];
	displayValue?: string;
	valueRange?: Range;
	hexValue?: string;
	numeric?: boolean;
	instance?: boolean;
	targetRaw?: string;
	targetPath?: string;
	targetRange?: Range;
	contextRaw?: string[];
	contextPaths?: string[];
	criterionRaw?: string;
	pbValueRaw?: string;
	syscond?: string;
	syscondRange?: Range;
	pbVariants?: { criterion: string; operator: string; value: string }[];
	postBuildRange?: Range;
	label?: string;
	text?: string;
	annotations?: { label?: string; text?: string; range?: Range }[];
	parameters?: Rec[];
	references?: Rec[];
	containers?: Rec[];
}

/** Element stack entry; `text` accumulates the raw characters of the open element. */
interface Entry {
	name: string;
	/** Offset of the element's `<`. */
	start: number;
	text: string;
	/** Offset of the first raw text character, or -1. */
	textStart: number;
	/** Offset just past the last raw text character, or -1. */
	textEnd: number;
	rec?: Rec;
	/** Set on `<VALUE>`: which enclosing element decides its meaning (child design §2.1). */
	valueRole?: 'param' | 'pb';
}

const NODE_KINDS: RecKind[] = ['module', 'container', 'param', 'reference'];
const TEXT_TAGS = new Set([
	'SHORT-NAME',
	'DEFINITION-REF',
	'IMPLEMENTATION-CONFIG-VARIANT',
	'SW-SYSCOND',
	'MATCHING-CRITERION-REF',
	// The legacy `\formatAnnotation` reads the AUTOSAR language layers, not the
	// enclosing `LABEL` / `ANNOTATION-TEXT` / `VERBATIM` elements themselves.
	'L-4',
	'L-5',
	'VALUE-REF',
	'TARGET-REF',
	'CONTEXT-ELEMENT-REF',
]);

/** Scans an ECUC-Values arxml text into its ARTEXT model. */
export function scanEcucValues(text: string): EcucDocumentModel {
	const stack: Entry[] = [];
	const modules: ModuleNode[] = [];
	const packages: { path: string[]; range: Range }[] = [];
	const pathIndex = new Map<string, Range>();
	const packageRanges = new Map<string, Range>();
	const pendingPackages: string[][] = [];
	const model: EcucDocumentModel = { packages, modules, pathIndex };
	const len = text.length;
	let i = 0;

	/** Appends raw characters `[from, to)` to the innermost open element. */
	const append = (raw: string, from: number, to: number): void => {
		const e = stack[stack.length - 1];
		if (!e) {
			return;
		}
		e.text += raw;
		if (e.textStart < 0) {
			e.textStart = from;
		}
		e.textEnd = to;
	};

	/** Parses one tag at `at`; returns the offset just past it. */
	const readTag = (at: number): number => {
		const start = at;
		let j = at + 1;
		let closing = false;
		if (text[j] === '/') {
			closing = true;
			j++;
		}
		const nameStart = j;
		while (j < len && !isWs(text[j]) && text[j] !== '>' && text[j] !== '/') {
			j++;
		}
		const name = stripPrefix(text.slice(nameStart, j));
		const attrs = new Map<string, string>();
		let selfClosing = false;

		while (j < len) {
			while (j < len && isWs(text[j])) {
				j++;
			}
			const c = text[j];
			if (c === undefined) {
				break;
			}
			if (c === '>') {
				j++;
				break;
			}
			if (c === '/') {
				j++;
				if (text[j] === '>') {
					j++;
					selfClosing = true;
				}
				break;
			}
			const attrStart = j;
			while (j < len && !isWs(text[j]) && text[j] !== '=' && text[j] !== '>' && text[j] !== '/') {
				j++;
			}
			const attrName = stripPrefix(text.slice(attrStart, j));
			while (j < len && isWs(text[j])) {
				j++;
			}
			if (text[j] !== '=') {
				if (attrName) {
					attrs.set(attrName, '');
				}
				continue;
			}
			j++;
			while (j < len && isWs(text[j])) {
				j++;
			}
			const quote = text[j];
			if (quote === '"' || quote === "'") {
				// Quote-aware: a '>' inside the value cannot terminate the tag.
				j++;
				const valueStart = j;
				while (j < len && text[j] !== quote) {
					j++;
				}
				attrs.set(attrName, text.slice(valueStart, j));
				if (j < len) {
					j++;
				}
			} else {
				const valueStart = j;
				while (j < len && !isWs(text[j]) && text[j] !== '>') {
					j++;
				}
				attrs.set(attrName, text.slice(valueStart, j));
			}
		}

		if (closing) {
			closeElement(name, j);
			return j;
		}

		const entry: Entry = { name, start, text: '', textStart: -1, textEnd: -1 };
		entry.rec = openRecord(name, attrs);
		if (entry.rec?.kind === 'value') {
			entry.valueRole = valueRole(stack);
		}
		stack.push(entry);
		if (selfClosing) {
			// Pushed and immediately popped, so a single close path serves both forms.
			closeElement(name, j);
		}
		return j;
	};

	/** Closes the nearest matching open element, and anything it is nested in. */
	const closeElement = (name: string, end: number): void => {
		let idx = -1;
		for (let k = stack.length - 1; k >= 0; k--) {
			if (stack[k].name === name) {
				idx = k;
				break;
			}
		}
		if (idx < 0) {
			return; // stray end tag
		}
		const closing = stack.splice(idx);
		for (let k = closing.length - 1; k >= 0; k--) {
			finish(closing[k], end, stack);
		}
	};

	/** Finalizes one element as its tags close. */
	const finish = (entry: Entry, end: number, ancestors: Entry[]): void => {
		const rec = entry.rec;
		if (!rec) {
			return;
		}
		rec.range = { start: entry.start, end };
		switch (rec.kind) {
			case 'autosar':
				applySchema(rec, model);
				return;
			case 'package':
			case 'module':
			case 'container':
				finishNode(rec, ancestors);
				return;
			case 'param':
				if (rec.displayValue === undefined) {
					// Only a `<VALUE>` child normally supplies the value; this covers a parameter
					// written as bare text.
					rec.displayValue = decode(entry.text).trim();
				}
				if (rec.numeric) {
					rec.hexValue = hexOf(rec.displayValue);
				}
				attachChild(ancestors, rec);
				return;
			case 'reference':
				rec.targetRaw = (rec.targetRaw ?? '').trim();
				rec.targetPath = structify(rec.targetRaw);
				rec.contextPaths = (rec.contextRaw ?? []).map(structify);
				delete rec.contextRaw;
				attachChild(ancestors, rec);
				return;
			case 'text':
				finishText(entry, rec, ancestors);
				return;
			case 'value':
				finishValue(entry, ancestors);
				return;
			case 'pbConditions': {
				const parent = nearest(ancestors, ...NODE_KINDS);
				if (parent) {
					parent.postBuildRange = rec.range;
				}
				return;
			}
			case 'pbCondition': {
				const parent = nearest(ancestors, ...NODE_KINDS);
				if (parent) {
					(parent.pbVariants ??= []).push({
						criterion: lastShortName(rec.criterionRaw ?? ''),
						operator: '==',
						value: (rec.pbValueRaw ?? '').trim(),
					});
				}
				return;
			}
			case 'annotation': {
				// One list entry per `ANNOTATION`. The legacy `\appendAnnotations`
				// concatenates every annotation into a single `/* … */` run; a list is
				// our deliberate semantic-preserving deviation (parent D6).
				const parent = nearest(ancestors, 'annotations');
				if (parent) {
					(parent.annotations ??= []).push(
						compact({
							label: rec.label,
							text: rec.text,
							range: rec.range,
						})
					);
				}
				return;
			}
			case 'annotations': {
				const parent = nearest(ancestors, ...NODE_KINDS);
				if (parent && rec.annotations && rec.annotations.length > 0) {
					parent.annotations = rec.annotations;
				}
				return;
			}
		}
	};

	const finishNode = (rec: Rec, ancestors: Entry[]): void => {
		const pkgChain = ancestorShortNames(ancestors, 'package');
		const shortName = rec.shortName ?? '';

		if (rec.kind === 'package') {
			const chain = [...pkgChain, shortName];
			addIndexKey(pathIndex, chain, rec.range);
			// Recorded now: the package's own range is only known once its tags close.
			packageRanges.set('/' + chain.join('/'), rec.range!);
			return;
		}

		if (rec.kind === 'module') {
			addIndexKey(pathIndex, [...pkgChain, shortName], rec.range);
			const containerRecs = rec.containers ?? [];
			modules.push(
				compact<ModuleNode>({
					kind: 'module',
					definitionRef: rec.definitionRef ?? '',
					definitionRefRange: rec.definitionRefRange,
					shortName,
					shortNameRange: rec.shortNameRange,
					variant: rec.variant,
					variantRange: rec.variantRange,
					range: rec.range!,
					containers: containerRecs.map(toContainer),
					...suffixesOf(rec),
				})
			);
			if (pkgChain.length > 0) {
				const key = pkgChain.join('/');
				if (!pendingPackages.some((p) => p.join('/') === key)) {
					pendingPackages.push(pkgChain);
				}
			}
			return;
		}

		// Container: package chain, then the module short-name, then enclosing container
		// short-names. Settled in child design §2.2 — see containerPath below.
		const moduleRec = nearest(ancestors, 'module');
		const containerChain = ancestorShortNames(ancestors, 'container');
		rec.containerPath = [...pkgChain, moduleRec?.shortName ?? '', ...containerChain];
		addIndexKey(pathIndex, [...rec.containerPath, shortName], rec.range);
		attachChild(ancestors, rec);
	};

	const attachChild = (ancestors: Entry[], rec: Rec): void => {
		const parent = nearest(ancestors, 'container') ?? nearest(ancestors, 'module');
		if (!parent) {
			return;
		}
		if (rec.kind === 'container') {
			(parent.containers ??= []).push(rec);
		} else if (rec.kind === 'param') {
			(parent.parameters ??= []).push(rec);
		} else {
			(parent.references ??= []).push(rec);
		}
	};

	const finishText = (entry: Entry, rec: Rec, ancestors: Entry[]): void => {
		const raw = entry.text;
		const range = textRange(entry);
		switch (rec.name) {
			case 'SHORT-NAME': {
				// A short name belongs to the element it is a direct child of; a short name of an
				// element the model does not capture (e.g. inside a foreign collection) is ignored
				// rather than mis-attributed to the enclosing node.
				const parent = immediate(ancestors, 'package', ...NODE_KINDS);
				if (parent) {
					parent.shortName = raw.trim();
					parent.shortNameRange = range;
				}
				return;
			}
			case 'DEFINITION-REF': {
				const parent = immediate(ancestors, ...NODE_KINDS);
				if (parent) {
					parent.definitionRef = raw.trim();
					parent.definitionRefRange = range;
				}
				return;
			}
			case 'IMPLEMENTATION-CONFIG-VARIANT': {
				const parent = immediate(ancestors, 'module');
				if (parent) {
					parent.variant = raw.trim();
					parent.variantRange = range;
				}
				return;
			}
			case 'SW-SYSCOND': {
				const parent = nearest(ancestors, ...NODE_KINDS);
				if (parent) {
					parent.syscond = decode(raw).trim();
					parent.syscondRange = range;
				}
				return;
			}
			case 'MATCHING-CRITERION-REF': {
				const parent = nearest(ancestors, 'pbCondition');
				if (parent) {
					parent.criterionRaw = raw.trim();
				}
				return;
			}
			case 'L-4': {
				// Label = `LABEL/L-4` text. The `.mm` has no language predicate, so the
				// first `L-4` in document order wins; later layers are ignored.
				const parent = hasAncestor(ancestors, 'LABEL') ? nearest(ancestors, 'annotation') : undefined;
				if (parent && parent.label === undefined) {
					parent.label = decode(raw).trim();
				}
				return;
			}
			case 'L-5': {
				// Text = `ANNOTATION-TEXT/VERBATIM/L-5` text, first in document order.
				const parent =
					hasAncestor(ancestors, 'ANNOTATION-TEXT') && hasAncestor(ancestors, 'VERBATIM')
						? nearest(ancestors, 'annotation')
						: undefined;
				if (parent && parent.text === undefined) {
					parent.text = decode(raw).trim();
				}
				return;
			}
			case 'VALUE-REF':
			case 'TARGET-REF': {
				const parent = nearest(ancestors, 'reference');
				if (parent) {
					parent.targetRaw = raw.trim();
					parent.targetRange = range;
				}
				return;
			}
			case 'CONTEXT-ELEMENT-REF': {
				const parent = nearest(ancestors, 'reference');
				if (parent) {
					(parent.contextRaw ??= []).push(raw.trim());
				}
				return;
			}
			default:
				return;
		}
	};

	const finishValue = (entry: Entry, ancestors: Entry[]): void => {
		if (entry.valueRole === 'pb') {
			const parent = nearest(ancestors, 'pbCondition');
			if (parent) {
				parent.pbValueRaw = entry.text;
			}
			return;
		}
		if (entry.valueRole === 'param') {
			const parent = nearest(ancestors, 'param');
			if (parent) {
				// Decoded for display only; `valueRange` still points at the raw text.
				parent.displayValue = decode(entry.text).trim();
				// Text present -> the inner text span, so the tags and surrounding whitespace stay
				// untouched. Empty or self-closing -> the whole element span, which is the only
				// shape a write may replace structurally (parent design §8).
				parent.valueRange = textRange(entry) ?? entry.rec?.range;
			}
		}
	};

	const toParameter = (rec: Rec): ParameterNode => {
		const definitionRef = rec.definitionRef ?? '';
		return compact<ParameterNode>({
			kind: 'parameter',
			numeric: rec.numeric === true,
			definitionRef,
			definitionRefRange: rec.definitionRefRange,
			name: lastShortName(definitionRef),
			displayValue: rec.displayValue,
			hexValue: rec.hexValue,
			valueRange: rec.valueRange,
			range: rec.range!,
			...suffixesOf(rec),
		});
	};

	const toReference = (rec: Rec): ReferenceNode => {
		const definitionRef = rec.definitionRef ?? '';
		return compact<ReferenceNode>({
			kind: 'reference',
			instance: rec.instance === true,
			definitionRef,
			definitionRefRange: rec.definitionRefRange,
			name: lastShortName(definitionRef),
			targetRawPath: rec.targetRaw,
			targetPath: rec.targetPath,
			contextPaths: rec.contextPaths ?? [],
			targetRange: rec.targetRange,
			range: rec.range!,
			...suffixesOf(rec),
		});
	};

	const toContainer = (rec: Rec): ContainerNode => {
		const definitionRef = rec.definitionRef ?? '';
		return compact<ContainerNode>({
			kind: 'container',
			definitionRef,
			definitionRefRange: rec.definitionRefRange,
			shortName: rec.shortName ?? '',
			shortNameRange: rec.shortNameRange,
			range: rec.range!,
			containerPath: rec.containerPath ?? [],
			parameters: (rec.parameters ?? []).map(toParameter),
			references: (rec.references ?? []).map(toReference),
			containers: (rec.containers ?? []).map(toContainer),
			...suffixesOf(rec),
		});
	};

	while (i < len) {
		const lt = text.indexOf('<', i);
		const runEnd = lt < 0 ? len : lt;
		if (runEnd > i) {
			append(text.slice(i, runEnd), i, runEnd);
			i = runEnd;
			if (lt < 0) {
				break;
			}
		}
		if (text.startsWith('<!--', i)) {
			const e = text.indexOf('-->', i + 4);
			i = e < 0 ? len : e + 3;
			continue;
		}
		if (text.startsWith('<![CDATA[', i)) {
			const e = text.indexOf(']]>', i + 9);
			const stop = e < 0 ? len : e;
			// An empty `<![CDATA[]]>` must not register a text chunk: it would set the
			// element's text start/end to the marker itself and widen the recorded range
			// past the real text (a write would then replace `]]>` or `<![CDATA[`).
			if (stop > i + 9) {
				append(text.slice(i + 9, stop), i + 9, stop);
			}
			i = e < 0 ? len : e + 3;
			continue;
		}
		if (text.startsWith('<?', i)) {
			const e = text.indexOf('?>', i + 2);
			i = e < 0 ? len : e + 2;
			continue;
		}
		if (text.startsWith('<!', i)) {
			i = skipMarkupDeclaration(text, i);
			continue;
		}
		i = readTag(i);
	}

	// Ancestor AR-PACKAGE chain per module, with the chain's own element range.
	for (const chain of pendingPackages) {
		const range = packageRanges.get('/' + chain.join('/'));
		if (range) {
			packages.push({ path: chain, range });
		}
	}

	return model;
}

/** Creates the capture record for `name`, or `undefined` for structural elements. */
function openRecord(name: string, attrs: Map<string, string>): Rec | undefined {
	const base = (kind: RecKind): Rec => ({ kind, name });
	switch (name) {
		case 'AUTOSAR':
			return { ...base('autosar'), attrs };
		case 'AR-PACKAGE':
			return base('package');
		case 'ECUC-MODULE-CONFIGURATION-VALUES':
			return { ...base('module'), parameters: [], references: [], containers: [] };
		case 'ECUC-CONTAINER-VALUE':
			return { ...base('container'), parameters: [], references: [], containers: [] };
		case 'ECUC-NUMERICAL-PARAM-VALUE':
			return { ...base('param'), numeric: true };
		case 'ECUC-TEXTUAL-PARAM-VALUE':
			return { ...base('param'), numeric: false };
		case 'ECUC-REFERENCE-VALUE':
			return { ...base('reference'), instance: false, contextRaw: [] };
		case 'ECUC-INSTANCE-REFERENCE-VALUE':
			return { ...base('reference'), instance: true, contextRaw: [] };
		case 'POST-BUILD-VARIANT-CONDITIONS':
			return base('pbConditions');
		case 'POST-BUILD-VARIANT-CONDITION':
			return base('pbCondition');
		case 'ANNOTATIONS':
			return base('annotations');
		case 'ANNOTATION':
			return base('annotation');
		case 'VALUE':
			return base('value');
		default:
			// VARIATION-POINT, ELEMENTS, CONTAINERS, PARAMETER-VALUES, REFERENCE-VALUES,
			// SUB-CONTAINERS and other structural elements are traversed but not recorded;
			// their contents attach to the nearest enclosing node.
			return TEXT_TAGS.has(name) ? base('text') : undefined;
	}
}

/** Extracts the shared `Suffixes` fields from a record; absent fields stay absent. */
function suffixesOf(rec: Rec): {
	syscond?: string;
	syscondRange?: Range;
	postBuildVariants?: { criterion: string; operator: string; value: string }[];
	postBuildRange?: Range;
	annotations?: { label?: string; text?: string; range?: Range }[];
} {
	return {
		syscond: rec.syscond,
		syscondRange: rec.syscondRange,
		postBuildVariants: rec.pbVariants,
		postBuildRange: rec.postBuildRange,
		annotations: rec.annotations,
	};
}

/**
 * Schema release from `xsi:schemaLocation` (legacy §2.2): last whitespace token,
 * first `.`-segment, last `_`-segment, `-` replaced by `.`. `AUTOSAR_00048.xsd`
 * therefore yields `00048`.
 */
function schemaReleaseFrom(schemaLocation: string): string | undefined {
	const tokens = schemaLocation.trim().split(/\s+/);
	const last = tokens[tokens.length - 1];
	if (!last) {
		return undefined;
	}
	const parts = last.split('.')[0].split('_');
	return parts[parts.length - 1].replace(/-/g, '.');
}

function applySchema(rec: Rec, model: EcucDocumentModel): void {
	const location = rec.attrs?.get('schemaLocation');
	if (location) {
		const release = schemaReleaseFrom(location);
		if (release !== undefined) {
			model.schema = { release };
		}
	}
}

/** Records a path -> range entry; first occurrence wins. */
function addIndexKey(index: Map<string, Range>, chain: string[], range: Range | undefined): void {
	if (!range || chain.length === 0) {
		return;
	}
	const key = '/' + chain.join('/');
	if (!index.has(key)) {
		index.set(key, range);
	}
}

/** Short names of ancestor records of one kind, outermost first. */
function ancestorShortNames(ancestors: Entry[], kind: RecKind): string[] {
	const out: string[] = [];
	for (const a of ancestors) {
		if (a.rec?.kind === kind && a.rec.shortName) {
			out.push(a.rec.shortName);
		}
	}
	return out;
}

/** Nearest ancestor record of any of `kinds`, innermost first. */
function nearest(ancestors: Entry[], ...kinds: RecKind[]): Rec | undefined {
	for (let k = ancestors.length - 1; k >= 0; k--) {
		const rec = ancestors[k].rec;
		if (rec && kinds.includes(rec.kind)) {
			return rec;
		}
	}
	return undefined;
}

/** True when one of the open ancestors is the (prefix-stripped) tag `name`. */
function hasAncestor(ancestors: Entry[], name: string): boolean {
	return ancestors.some((a) => a.name === name);
}

/**
 * The record of the element directly enclosing the current one, when it is one of
 * `kinds`. Used where an element belongs to its parent element specifically, not to
 * the nearest enclosing captured node.
 */
function immediate(ancestors: Entry[], ...kinds: RecKind[]): Rec | undefined {
	const rec = ancestors[ancestors.length - 1]?.rec;
	return rec && kinds.includes(rec.kind) ? rec : undefined;
}

/** Which enclosing element decides a `<VALUE>` (child design §2.1). */
function valueRole(stack: Entry[]): 'param' | 'pb' | undefined {
	const parent = stack[stack.length - 1]?.name;
	if (parent === 'ECUC-NUMERICAL-PARAM-VALUE' || parent === 'ECUC-TEXTUAL-PARAM-VALUE') {
		return 'param';
	}
	if (parent === 'POST-BUILD-VARIANT-CONDITION') {
		return 'pb';
	}
	return undefined;
}

/** Raw, whitespace-trimmed span of an element's text content. */
function textRange(entry: Entry): Range | undefined {
	if (entry.textStart < 0 || entry.textEnd <= entry.textStart || entry.text.trim() === '') {
		return undefined;
	}
	const leading = entry.text.length - entry.text.trimStart().length;
	const trailing = entry.text.length - entry.text.trimEnd().length;
	return { start: entry.textStart + leading, end: entry.textEnd - trailing };
}

/** `/A/B/C` -> `A.B.C`: the legacy `\structify` (empty leading segment skipped). */
function structify(path: string): string {
	const parts = path.split('/');
	if (parts.length <= 1) {
		return path.trim();
	}
	return parts.slice(1).join('.');
}

/** `dec2hex` secondary text: `0x` + uppercase hex, integers only. */
function hexOf(value: string): string | undefined {
	if (value === '' || value === 'true' || value === 'false') {
		return undefined;
	}
	const n = Number(value);
	if (!Number.isFinite(n) || !Number.isInteger(n)) {
		return undefined;
	}
	if (Object.is(n, -0)) {
		return '0x0';
	}
	const hex = Math.abs(n).toString(16).toUpperCase();
	return n < 0 ? `-0x${hex}` : `0x${hex}`;
}

/** Decodes XML entity references, for display values only. */
function decode(raw: string): string {
	return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
		if (body.startsWith('#x') || body.startsWith('#X')) {
			const code = Number.parseInt(body.slice(2), 16);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		if (body.startsWith('#')) {
			const code = Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		switch (body) {
			case 'amp':
				return '&';
			case 'lt':
				return '<';
			case 'gt':
				return '>';
			case 'quot':
				return '"';
			case 'apos':
				return "'";
			default:
				return match;
		}
	});
}

/** Skips `<!DOCTYPE …>` including an internal subset in brackets. */
function skipMarkupDeclaration(src: string, at: number): number {
	let j = at + 2;
	let depth = 0;
	let quote: string | undefined;
	while (j < src.length) {
		const c = src[j];
		if (quote !== undefined) {
			if (c === quote) {
				quote = undefined;
			}
		} else if (c === '"' || c === "'") {
			quote = c;
		} else if (c === '[') {
			depth++;
		} else if (c === ']') {
			depth--;
		} else if (c === '>' && depth <= 0) {
			return j + 1;
		}
		j++;
	}
	return src.length;
}

/** Strips a namespace prefix before comparing a tag or attribute name. */
function stripPrefix(name: string): string {
	const colon = name.lastIndexOf(':');
	return colon < 0 ? name : name.slice(colon + 1);
}

function isWs(c: string | undefined): boolean {
	return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

/** Drops `undefined`-valued own properties so the model is JSON-clean. */
function compact<T extends object>(value: T): T {
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (record[key] === undefined) {
			delete record[key];
		}
	}
	return value;
}
