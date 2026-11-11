/**
 * Single-pass, iterative ECUC-Values scanner.
 *
 * Hand-written lexer plus an element stack. No DOM, no recursion: nesting depth
 * cannot overflow the call stack. The returned model holds only strings, numbers
 * and ranges, so it retains no reference to the input string.
 *
 */
import { ContainerNode, EcucDocumentModel, ModuleNode, ParameterNode, Range, ReferenceNode, lastShortName } from './model';
import { decodeXml, isXmlWhitespace, markupDeclarationEnd, stripXmlPrefix } from '../text/xmlText';
import { schemaReleaseFrom } from './schemaRelease';

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
	/** `DEFINITION-REF DEST`, when present. */
	definitionDest?: string;
	/** `VALUE-REF` / `TARGET-REF` `DEST`, when present. */
	targetDest?: string;
	shortName?: string;
	shortNameRange?: Range;
	variant?: string;
	variantRange?: Range;
	containerPath?: string[];
	displayValue?: string;
	valueRange?: Range;
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

/**
 * Element stack entry; `text` accumulates the open element's text. For
 * `SW-SYSCOND` that text is the joined condition (trimmed runs and the path tail
 * of each inline `SYSC-REF`), so `textStart`/`textEnd` bound that text rather
 * than the element's raw characters.
 */
interface Entry {
	name: string;
	/** Offset of the element's `<`. */
	start: number;
	text: string;
	/** Offset of the first character of `text`, or -1. */
	textStart: number;
	/** Offset just past the last character of `text`, or -1. */
	textEnd: number;
	rec?: Rec;
	/** Attributes retained for `DEFINITION-REF` (its `DEST` type). */
	attrs?: Map<string, string>;
	/** Set on `<VALUE>`: which enclosing element decides its meaning. */
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

	/** Skips XML whitespace from `from`. */
	const skipWhitespace = (from: number): number => {
		let at = from;
		while (at < len && isXmlWhitespace(text[at])) {
			at++;
		}
		return at;
	};

	/** Count of XML whitespace characters at the start of `raw`. */
	const leadingWhitespace = (raw: string): number => {
		let at = 0;
		while (at < raw.length && isXmlWhitespace(raw[at])) {
			at++;
		}
		return at;
	};

	/** Count of XML whitespace characters at the end of `raw`, before `leading`. */
	const trailingWhitespace = (raw: string, leading: number): number => {
		let at = 0;
		while (at < raw.length - leading && isXmlWhitespace(raw[raw.length - 1 - at])) {
			at++;
		}
		return at;
	};

	/** An open `SW-SYSCOND` run without its formatting whitespace. */
	const syscondRun = (
		raw: string,
		from: number,
		to: number
	): { chunk: string; start: number; end: number } => {
		const leading = leadingWhitespace(raw);
		const trailing = trailingWhitespace(raw, leading);
		return {
			chunk: raw.slice(leading, raw.length - trailing),
			start: from + leading,
			end: to - trailing,
		};
	};

	/** The captured run and its offsets, whitespace-trimmed inside `SW-SYSCOND`. */
	const capturedRun = (
		e: Entry,
		raw: string,
		from: number,
		to: number
	): { chunk: string; start: number; end: number } => {
		if (e.name !== 'SW-SYSCOND') {
			return { chunk: raw, start: from, end: to };
		}
		return syscondRun(raw, from, to);
	};

	/** Appends raw characters `[from, to)` to the innermost open element. */
	const append = (raw: string, from: number, to: number): void => {
		const e = stack[stack.length - 1];
		if (!e) {
			return;
		}
		// The formatting whitespace between a condition's parts is not part of the
		// condition: the legacy text joins the trimmed parts, so
		// `(\n <SYSC-REF/> \n ==0)` reads `(CANIPCORETYPE_SC==0)`. XML whitespace
		// only, matching `isWs`, so a condition's own characters are never dropped.
		const run = capturedRun(e, raw, from, to);
		if (run.chunk === '') {
			return;
		}
		e.text += run.chunk;
		if (e.textStart < 0) {
			e.textStart = run.start;
		}
		e.textEnd = run.end;
	};

	/** Whitespace, `>`, and `/` end an element name. */
	const isNameStop = (character: string): boolean =>
		isXmlWhitespace(character) || character === '>' || character === '/';

	/** `=` ends an attribute name in addition to the element-name stops. */
	const isAttributeNameStop = (character: string): boolean =>
		isNameStop(character) || character === '=';

	/** Scans an element name and strips its namespace prefix. */
	const readName = (from: number): { value: string; end: number } => {
		let at = from;
		while (at < len && !isNameStop(text[at])) {
			at++;
		}
		return { value: stripXmlPrefix(text.slice(from, at)), end: at };
	};

	/** Scans an attribute name and strips its namespace prefix. */
	const readAttributeName = (from: number): { value: string; end: number } => {
		let at = from;
		while (at < len && !isAttributeNameStop(text[at])) {
			at++;
		}
		return { value: stripXmlPrefix(text.slice(from, at)), end: at };
	};

	/** An unquoted attribute value: everything up to whitespace or `>`. */
	const readBareValue = (from: number): { value: string; end: number } => {
		let at = from;
		while (at < len && !isXmlWhitespace(text[at]) && text[at] !== '>') {
			at++;
		}
		return { value: text.slice(from, at), end: at };
	};

	/** A quoted attribute value: everything up to the matching quote. */
	const readQuotedValue = (from: number, quote: string): { value: string; end: number } => {
		let at = from + 1;
		while (at < len && text[at] !== quote) {
			at++;
		}
		return { value: text.slice(from + 1, at), end: at < len ? at + 1 : at };
	};

	/** Reads one attribute value; quote-aware, so `>` inside it cannot end the tag. */
	const readAttributeValue = (from: number): { value: string; end: number } => {
		const quote = text[from];
		if (quote === '"' || quote === "'") {
			return readQuotedValue(from, quote);
		}
		return readBareValue(from);
	};

	/** Reads one attribute (or a valueless name) and returns the new offset. */
	const readAttribute = (from: number, attrs: Map<string, string>): number => {
		const name = readAttributeName(from);
		const afterName = skipWhitespace(name.end);
		if (text[afterName] !== '=') {
			if (name.value) {
				attrs.set(name.value, '');
			}
			return afterName;
		}
		const value = readAttributeValue(skipWhitespace(afterName + 1));
		attrs.set(name.value, value.value);
		return value.end;
	};

	/** The end of a tag's attribute list, and whether it self-closes. */
	interface TagStop {
		end: number;
		selfClosing: boolean;
	}

	const selfCloseStop = (at: number): TagStop => {
		const closes = text[at + 1] === '>';
		return { end: closes ? at + 2 : at + 1, selfClosing: closes };
	};

	/** `>` or the `/>` pair at `at`, or `undefined` for another attribute. */
	const tagStop = (at: number): TagStop | undefined => {
		const character = text[at];
		if (character === '>') {
			return { end: at + 1, selfClosing: false };
		}
		if (character === undefined) {
			return { end: at, selfClosing: false };
		}
		return character === '/' ? selfCloseStop(at) : undefined;
	};

	/** Reads every attribute of a tag up to its `>` or `/>`. */
	const readAttributes = (from: number, attrs: Map<string, string>): TagStop => {
		let at = from;
		while (at < len) {
			const skipped = skipWhitespace(at);
			const stop = tagStop(skipped);
			if (stop !== undefined) {
				return stop;
			}
			at = readAttribute(skipped, attrs);
		}
		return { end: at, selfClosing: false };
	};

	/** The tag names whose `DEST` attribute the scanner keeps. */
	const keepsAttributes = (name: string): boolean =>
		name === 'DEFINITION-REF' || name === 'VALUE-REF' || name === 'TARGET-REF';

	/** A record whose `<VALUE>` child carries a parameter's or condition's value. */
	const isValueRecord = (rec: Rec | undefined): boolean => rec?.kind === 'value';

	/** Pushes the open element's entry, closing it at once when self-closing. */
	const openElement = (
		name: string,
		start: number,
		end: number,
		attrs: Map<string, string>,
		selfClosing: boolean
	): void => {
		const entry: Entry = { name, start, text: '', textStart: -1, textEnd: -1 };
		if (keepsAttributes(name)) {
			entry.attrs = attrs;
		}
		entry.rec = openRecord(name, attrs);
		if (isValueRecord(entry.rec)) {
			entry.valueRole = valueRole(stack);
		}
		stack.push(entry);
		if (selfClosing) {
			// Pushed and immediately popped, so a single close path serves both forms.
			closeElement(name, end);
		}
	};

	/** Parses one tag at `at`; returns the offset just past it. */
	const readTag = (at: number): number => {
		const start = at;
		const closing = text[at + 1] === '/';
		const name = readName(closing ? at + 2 : at + 1);
		const attrs = new Map<string, string>();
		const tail = readAttributes(name.end, attrs);
		if (closing) {
			closeElement(name.value, tail.end);
			return tail.end;
		}
		openElement(name.value, start, tail.end, attrs, tail.selfClosing);
		return tail.end;
	};

	/** The stack index of the nearest open element called `name`, or -1. */
	const findOpenElement = (name: string): number => {
		for (let at = stack.length - 1; at >= 0; at--) {
			if (stack[at].name === name) {
				return at;
			}
		}
		return -1;
	};

	/** Finalizes the spliced entries innermost first. */
	const finishClosed = (closing: Entry[], end: number): void => {
		for (let at = closing.length - 1; at >= 0; at--) {
			finish(closing[at], end, stack);
		}
	};

	/** Closes the nearest matching open element, and anything it is nested in. */
	const closeElement = (name: string, end: number): void => {
		const idx = findOpenElement(name);
		if (idx < 0) {
			return; // stray end tag
		}
		finishClosed(stack.splice(idx), end);
	};

	/** Finalizes one element as its tags close. */
	const finish = (entry: Entry, end: number, ancestors: Entry[]): void => {
		if (entry.name === 'SYSC-REF') {
			finishSyscRef(entry, ancestors);
			return;
		}
		const rec = entry.rec;
		if (!rec) {
			return;
		}
		rec.range = { start: entry.start, end };
		finishRecord(rec, entry, ancestors);
	};

	const isSyscondHolder = (entry: Entry | undefined): entry is Entry =>
		entry !== undefined && entry.name === 'SW-SYSCOND';

	/** Where the substituted tail starts inside the condition's captured text. */
	const syscRefStart = (entry: Entry, tail: string): number => {
		const at = tail === '' ? -1 : entry.text.lastIndexOf(tail);
		return entry.textStart >= 0 && at >= 0 ? entry.textStart + at : entry.start;
	};

	/**
	 * A condition can name a system constant inline. The captured text is the
	 * raw runs only, so the reference has to be substituted where it stood —
	 * the legacy text uses the path tail, not the full path.
	 */
	const finishSyscRef = (entry: Entry, ancestors: Entry[]): void => {
		const holder = ancestors[ancestors.length - 1];
		if (!isSyscondHolder(holder)) {
			return;
		}
		const tail = lastShortName(entry.text.trim());
		holder.text += tail;
		// The range must bound the condition text, not the reference's markup:
		// when nothing precedes the reference the condition text starts with the
		// tail, so the anchor is the tail inside the captured path. A range over
		// `<SYSC-REF …>` would make reveal/selection highlight markup.
		const start = syscRefStart(entry, tail);
		if (holder.textStart < 0) {
			holder.textStart = start;
		}
		holder.textEnd = start + tail.length;
	};

	const isNodeRecord = (rec: Rec): boolean =>
		rec.kind === 'package' || rec.kind === 'module' || rec.kind === 'container';

	const finishRecord = (rec: Rec, entry: Entry, ancestors: Entry[]): void => {
		if (isNodeRecord(rec)) {
			finishNode(rec, ancestors);
			return;
		}
		if (rec.kind === 'text') {
			finishText(entry, rec, ancestors);
			return;
		}
		finishNonNodeRecord(rec, entry, ancestors);
	};

	const finishNonNodeRecord = (rec: Rec, entry: Entry, ancestors: Entry[]): void => {
		if (rec.kind === 'param') {
			finishParam(rec, entry, ancestors);
			return;
		}
		if (rec.kind === 'reference') {
			finishReference(rec, ancestors);
			return;
		}
		finishMetaRecord(rec, entry, ancestors);
	};

	const finishMetaRecord = (rec: Rec, entry: Entry, ancestors: Entry[]): void => {
		if (rec.kind === 'autosar') {
			applySchema(rec, model);
			return;
		}
		if (rec.kind === 'value') {
			finishValue(entry, ancestors);
			return;
		}
		finishConditionRecord(rec, ancestors);
	};

	const finishConditionRecord = (rec: Rec, ancestors: Entry[]): void => {
		if (rec.kind === 'pbConditions') {
			finishPbConditions(rec, ancestors);
			return;
		}
		if (rec.kind === 'pbCondition') {
			finishPbCondition(rec, ancestors);
			return;
		}
		finishAnnotationRecord(rec, ancestors);
	};

	const finishAnnotationRecord = (rec: Rec, ancestors: Entry[]): void => {
		if (rec.kind === 'annotation') {
			finishAnnotation(rec, ancestors);
			return;
		}
		finishAnnotations(rec, ancestors);
	};

	const finishParam = (rec: Rec, entry: Entry, ancestors: Entry[]): void => {
		if (rec.displayValue === undefined) {
			// Only a `<VALUE>` child normally supplies the value; this covers a parameter
			// written as bare text.
			rec.displayValue = decodeXml(entry.text).trim();
		}
		attachChild(ancestors, rec);
	};

	const finishReference = (rec: Rec, ancestors: Entry[]): void => {
		rec.targetRaw = (rec.targetRaw ?? '').trim();
		rec.targetPath = structify(rec.targetRaw);
		rec.contextPaths = (rec.contextRaw ?? []).map(structify);
		delete rec.contextRaw;
		attachChild(ancestors, rec);
	};

	const finishPbConditions = (rec: Rec, ancestors: Entry[]): void => {
		const parent = nearest(ancestors, ...NODE_KINDS);
		if (parent) {
			parent.postBuildRange = rec.range;
		}
	};

	const finishPbCondition = (rec: Rec, ancestors: Entry[]): void => {
		const parent = nearest(ancestors, ...NODE_KINDS);
		if (parent) {
			(parent.pbVariants ??= []).push(pbVariantOf(rec));
		}
	};

	/** The legacy `criterion == value` post-build variant a condition contributes. */
	const pbVariantOf = (rec: Rec): { criterion: string; operator: string; value: string } => ({
		criterion: lastShortName(rec.criterionRaw ?? ''),
		operator: '==',
		value: (rec.pbValueRaw ?? '').trim(),
	});

	const finishAnnotation = (rec: Rec, ancestors: Entry[]): void => {
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
	};

	const finishAnnotations = (rec: Rec, ancestors: Entry[]): void => {
		const parent = nearest(ancestors, ...NODE_KINDS);
		if (parent && rec.annotations && rec.annotations.length > 0) {
			parent.annotations = rec.annotations;
		}
	};

	const finishNode = (rec: Rec, ancestors: Entry[]): void => {
		const pkgChain = ancestorShortNames(ancestors, 'package');
		const shortName = rec.shortName ?? '';
		if (rec.kind === 'package') {
			finishPackage(rec, pkgChain, shortName);
			return;
		}
		if (rec.kind === 'module') {
			finishModule(rec, pkgChain, shortName);
			return;
		}
		finishContainer(rec, ancestors, pkgChain, shortName);
	};

	const finishPackage = (rec: Rec, pkgChain: string[], shortName: string): void => {
		const chain = [...pkgChain, shortName];
		addIndexKey(pathIndex, chain, rec.range);
		// Recorded now: the package's own range is only known once its tags close.
		packageRanges.set('/' + chain.join('/'), rec.range!);
	};

	/** Remembers a module's package chain for the post-scan package list. */
	const rememberPackage = (pkgChain: string[]): void => {
		const key = pkgChain.join('/');
		if (!pendingPackages.some((p) => p.join('/') === key)) {
			pendingPackages.push(pkgChain);
		}
	};

	const finishModule = (rec: Rec, pkgChain: string[], shortName: string): void => {
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
			rememberPackage(pkgChain);
		}
	};

	const finishContainer = (
		rec: Rec,
		ancestors: Entry[],
		pkgChain: string[],
		shortName: string
	): void => {
		// Container: package chain, then the module short-name, then enclosing container
		// short-names. See containerPath below.
		const moduleRec = nearest(ancestors, 'module');
		const containerChain = ancestorShortNames(ancestors, 'container');
		rec.containerPath = [...pkgChain, moduleRec?.shortName ?? '', ...containerChain];
		addIndexKey(pathIndex, [...rec.containerPath, shortName], rec.range);
		attachChild(ancestors, rec);
	};

	const appendContainerChild = (parent: Rec, rec: Rec): void => {
		(parent.containers ??= []).push(rec);
	};

	const appendParameterChild = (parent: Rec, rec: Rec): void => {
		(parent.parameters ??= []).push(rec);
	};

	const appendReferenceChild = (parent: Rec, rec: Rec): void => {
		(parent.references ??= []).push(rec);
	};

	const appendChildTo = (parent: Rec, rec: Rec): void => {
		if (rec.kind === 'container') {
			appendContainerChild(parent, rec);
			return;
		}
		if (rec.kind === 'param') {
			appendParameterChild(parent, rec);
			return;
		}
		appendReferenceChild(parent, rec);
	};

	const attachChild = (ancestors: Entry[], rec: Rec): void => {
		const parent = nearest(ancestors, 'container') ?? nearest(ancestors, 'module');
		if (!parent) {
			return;
		}
		appendChildTo(parent, rec);
	};

	const finishText = (entry: Entry, rec: Rec, ancestors: Entry[]): void => {
		const raw = entry.text;
		const range = textRange(entry);
		if (finishNameText(entry, rec, ancestors, raw, range)) {
			return;
		}
		if (finishConditionText(rec, ancestors, raw, range)) {
			return;
		}
		finishReferenceText(entry, rec, ancestors, raw, range);
	};

	/** `SHORT-NAME`, `DEFINITION-REF` and the implementation variant. */
	const finishNameText = (
		entry: Entry,
		rec: Rec,
		ancestors: Entry[],
		raw: string,
		range: Range | undefined
	): boolean => {
		if (rec.name === 'SHORT-NAME') {
			finishShortName(ancestors, raw, range);
			return true;
		}
		if (rec.name === 'DEFINITION-REF') {
			finishDefinitionRef(entry, ancestors, raw, range);
			return true;
		}
		if (rec.name === 'IMPLEMENTATION-CONFIG-VARIANT') {
			finishVariant(ancestors, raw, range);
			return true;
		}
		return false;
	};

	/** `SW-SYSCOND`, the post-build criterion and the annotation label layer. */
	const finishConditionText = (
		rec: Rec,
		ancestors: Entry[],
		raw: string,
		range: Range | undefined
	): boolean => {
		if (rec.name === 'SW-SYSCOND') {
			finishSyscond(ancestors, raw, range);
			return true;
		}
		if (rec.name === 'MATCHING-CRITERION-REF') {
			finishCriterion(ancestors, raw);
			return true;
		}
		if (rec.name === 'L-4') {
			finishLabel(ancestors, raw);
			return true;
		}
		return false;
	};

	/** The annotation text layer and the reference target/context texts. */
	const finishReferenceText = (
		entry: Entry,
		rec: Rec,
		ancestors: Entry[],
		raw: string,
		range: Range | undefined
	): void => {
		if (rec.name === 'L-5') {
			finishAnnotationText(ancestors, raw);
			return;
		}
		if (rec.name === 'VALUE-REF' || rec.name === 'TARGET-REF') {
			finishTargetRef(entry, ancestors, raw, range);
			return;
		}
		finishContextRef(ancestors, raw);
	};

	const finishShortName = (
		ancestors: Entry[],
		raw: string,
		range: Range | undefined
	): void => {
		// A short name belongs to the element it is a direct child of; a short name of an
		// element the model does not capture (e.g. inside a foreign collection) is ignored
		// rather than mis-attributed to the enclosing node.
		const parent = immediate(ancestors, 'package', ...NODE_KINDS);
		if (parent) {
			parent.shortName = raw.trim();
			parent.shortNameRange = range;
		}
	};

	/** The retained `DEST` attribute, when the tag carries one. */
	const destOf = (entry: Entry): string | undefined => entry.attrs?.get('DEST');

	const finishDefinitionRef = (
		entry: Entry,
		ancestors: Entry[],
		raw: string,
		range: Range | undefined
	): void => {
		const parent = immediate(ancestors, ...NODE_KINDS);
		if (parent) {
			parent.definitionRef = raw.trim();
			parent.definitionRefRange = range;
			const dest = destOf(entry);
			if (dest) {
				parent.definitionDest = dest.trim();
			}
		}
	};

	const finishVariant = (ancestors: Entry[], raw: string, range: Range | undefined): void => {
		const parent = immediate(ancestors, 'module');
		if (parent) {
			parent.variant = raw.trim();
			parent.variantRange = range;
		}
	};

	const finishSyscond = (ancestors: Entry[], raw: string, range: Range | undefined): void => {
		const parent = nearest(ancestors, ...NODE_KINDS);
		if (parent) {
			parent.syscond = decodeXml(raw).trim();
			parent.syscondRange = range;
		}
	};

	const finishCriterion = (ancestors: Entry[], raw: string): void => {
		const parent = nearest(ancestors, 'pbCondition');
		if (parent) {
			parent.criterionRaw = raw.trim();
		}
	};

	const finishLabel = (ancestors: Entry[], raw: string): void => {
		// Label = `LABEL/L-4` text. The `.mm` has no language predicate, so the
		// first `L-4` in document order wins; later layers are ignored.
		const parent = hasAncestor(ancestors, 'LABEL') ? nearest(ancestors, 'annotation') : undefined;
		if (parent && parent.label === undefined) {
			parent.label = decodeXml(raw).trim();
		}
	};

	const annotationTextParent = (ancestors: Entry[]): Rec | undefined =>
		hasAncestor(ancestors, 'ANNOTATION-TEXT') && hasAncestor(ancestors, 'VERBATIM')
			? nearest(ancestors, 'annotation')
			: undefined;

	const finishAnnotationText = (ancestors: Entry[], raw: string): void => {
		// Text = `ANNOTATION-TEXT/VERBATIM/L-5` text, first in document order.
		const parent = annotationTextParent(ancestors);
		if (parent && parent.text === undefined) {
			parent.text = decodeXml(raw).trim();
		}
	};

	const finishTargetRef = (
		entry: Entry,
		ancestors: Entry[],
		raw: string,
		range: Range | undefined
	): void => {
		const parent = nearest(ancestors, 'reference');
		if (parent) {
			parent.targetRaw = raw.trim();
			parent.targetRange = range;
			const dest = destOf(entry);
			if (dest) {
				parent.targetDest = dest.trim();
			}
		}
	};

	const finishContextRef = (ancestors: Entry[], raw: string): void => {
		const parent = nearest(ancestors, 'reference');
		if (parent) {
			(parent.contextRaw ??= []).push(raw.trim());
		}
	};

	const finishValue = (entry: Entry, ancestors: Entry[]): void => {
		if (entry.valueRole === 'pb') {
			finishPbValue(entry, ancestors);
			return;
		}
		if (entry.valueRole === 'param') {
			finishParamValue(entry, ancestors);
		}
	};

	const finishPbValue = (entry: Entry, ancestors: Entry[]): void => {
		const parent = nearest(ancestors, 'pbCondition');
		if (parent) {
			parent.pbValueRaw = entry.text;
		}
	};

	/** Text present -> the inner text span; empty or self-closing -> the element span. */
	const valueRangeOf = (entry: Entry): Range | undefined => textRange(entry) ?? entry.rec?.range;

	const finishParamValue = (entry: Entry, ancestors: Entry[]): void => {
		const parent = nearest(ancestors, 'param');
		if (parent) {
			// Decoded for display only; `valueRange` still points at the raw text.
			parent.displayValue = decodeXml(entry.text).trim();
			// Text present -> the inner text span, so the tags and surrounding whitespace stay
			// untouched. Empty or self-closing -> the whole element span, which is the only
			// shape a write may replace structurally.
			parent.valueRange = valueRangeOf(entry);
		}
	};

	const toParameter = (rec: Rec): ParameterNode => {
		const definitionRef = rec.definitionRef ?? '';
		return compact<ParameterNode>({
			kind: 'parameter',
			numeric: rec.numeric === true,
			definitionDest: rec.definitionDest,
			definitionRef,
			definitionRefRange: rec.definitionRefRange,
			name: lastShortName(definitionRef),
			displayValue: rec.displayValue,
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
			targetDest: rec.targetDest,
			targetPath: rec.targetPath,
			contextPaths: rec.contextPaths ?? [],
			targetRange: rec.targetRange,
			range: rec.range!,
			...suffixesOf(rec),
		});
	};

	const parametersOf = (rec: Rec): ParameterNode[] => (rec.parameters ?? []).map(toParameter);
	const referencesOf = (rec: Rec): ReferenceNode[] => (rec.references ?? []).map(toReference);
	const containersOf = (rec: Rec): ContainerNode[] => (rec.containers ?? []).map(toContainer);

	const toContainer = (rec: Rec): ContainerNode => {
		return compact<ContainerNode>({
			kind: 'container',
			definitionRef: rec.definitionRef ?? '',
			definitionRefRange: rec.definitionRefRange,
			shortName: rec.shortName ?? '',
			shortNameRange: rec.shortNameRange,
			range: rec.range!,
			containerPath: rec.containerPath ?? [],
			parameters: parametersOf(rec),
			references: referencesOf(rec),
			containers: containersOf(rec),
			...suffixesOf(rec),
		});
	};

	/** Appends the text run before the next `<`, if any. */
	const scanText = (): void => {
		const lt = text.indexOf('<', i);
		if (lt < 0) {
			append(text.slice(i, len), i, len);
			i = len;
			return;
		}
		if (lt > i) {
			append(text.slice(i, lt), i, lt);
			i = lt;
		}
	};

	/** Moves `i` past `marker`, or to the end when it is missing. */
	const skipTo = (marker: string, from: number, past: number): void => {
		const end = text.indexOf(marker, from);
		i = end < 0 ? len : end + past;
	};

	const skipComment = (): void => {
		skipTo('-->', i + 4, 3);
	};

	const skipCdata = (): void => {
		const end = text.indexOf(']]>', i + 9);
		const stop = end < 0 ? len : end;
		// An empty `<![CDATA[]]>` must not register a text chunk: it would set the
		// element's text start/end to the marker itself and widen the recorded range
		// past the real text (a write would then replace `]]>` or `<![CDATA[`).
		if (stop > i + 9) {
			append(text.slice(i + 9, stop), i + 9, stop);
		}
		i = end < 0 ? len : end + 3;
	};

	const skipProcessingInstruction = (): void => {
		skipTo('?>', i + 2, 2);
	};

	/** Comments and CDATA, whose content is not markup. */
	const scanCommentOrCdata = (): boolean => {
		if (text.startsWith('<!--', i)) {
			skipComment();
			return true;
		}
		if (text.startsWith('<![CDATA[', i)) {
			skipCdata();
			return true;
		}
		return false;
	};

	/** Processing instructions and markup declarations. */
	const scanPiOrDeclaration = (): boolean => {
		if (text.startsWith('<?', i)) {
			skipProcessingInstruction();
			return true;
		}
		if (text.startsWith('<!', i)) {
			i = skipMarkupDeclaration(text, i);
			return true;
		}
		return false;
	};

	/** Comments, CDATA, processing instructions and markup declarations. */
	const scanMarkup = (): boolean => scanCommentOrCdata() || scanPiOrDeclaration();

	const scanAll = (): void => {
		while (i < len) {
			scanText();
			// The text run reached the end: there is no tag to read.
			if (i >= len) {
				return;
			}
			if (scanMarkup()) {
				continue;
			}
			i = readTag(i);
		}
	};

	scanAll();

	// Ancestor AR-PACKAGE chain per module, with the chain's own element range.
	for (const chain of pendingPackages) {
		const range = packageRanges.get('/' + chain.join('/'));
		if (range) {
			packages.push({ path: chain, range });
		}
	}

	return model;
}

/** A bare capture record. */
function recordOf(kind: RecKind, name: string): Rec {
	return { kind, name };
}

/** The module/container records, which own child lists. */
function containerRecord(name: string): Rec | undefined {
	switch (name) {
		case 'ECUC-MODULE-CONFIGURATION-VALUES':
			return {
				...recordOf('module', name),
				parameters: [],
				references: [],
				containers: [],
			};
		case 'ECUC-CONTAINER-VALUE':
			return {
				...recordOf('container', name),
				parameters: [],
				references: [],
				containers: [],
			};
		default:
			return undefined;
	}
}

/** Numerical and textual parameters; the numeric flag is the value's type. */
function parameterRecord(name: string): Rec | undefined {
	switch (name) {
		case 'ECUC-NUMERICAL-PARAM-VALUE':
			return { ...recordOf('param', name), numeric: true };
		case 'ECUC-TEXTUAL-PARAM-VALUE':
			return { ...recordOf('param', name), numeric: false };
		default:
			return undefined;
	}
}

function referenceRecord(name: string): Rec | undefined {
	switch (name) {
		case 'ECUC-REFERENCE-VALUE':
			return { ...recordOf('reference', name), instance: false, contextRaw: [] };
		case 'ECUC-INSTANCE-REFERENCE-VALUE':
			return { ...recordOf('reference', name), instance: true, contextRaw: [] };
		default:
			return undefined;
	}
}

function nodeRecord(name: string): Rec | undefined {
	return containerRecord(name) ?? parameterRecord(name) ?? referenceRecord(name);
}

function autosarRecord(name: string, attrs: Map<string, string>): Rec | undefined {
	return name === 'AUTOSAR' ? { ...recordOf('autosar', name), attrs } : undefined;
}

function postBuildRecord(name: string): Rec | undefined {
	switch (name) {
		case 'POST-BUILD-VARIANT-CONDITIONS':
			return recordOf('pbConditions', name);
		case 'POST-BUILD-VARIANT-CONDITION':
			return recordOf('pbCondition', name);
		default:
			return undefined;
	}
}

function annotationRecord(name: string): Rec | undefined {
	switch (name) {
		case 'ANNOTATIONS':
			return recordOf('annotations', name);
		case 'ANNOTATION':
			return recordOf('annotation', name);
		case 'VALUE':
			return recordOf('value', name);
		default:
			return undefined;
	}
}

function packageRecord(name: string): Rec | undefined {
	return name === 'AR-PACKAGE' ? recordOf('package', name) : undefined;
}

function simpleRecord(name: string, attrs: Map<string, string>): Rec | undefined {
	return autosarRecord(name, attrs) ?? packageRecord(name) ?? postBuildRecord(name) ?? annotationRecord(name);
}

/** Creates the capture record for `name`, or `undefined` for structural elements. */
function openRecord(name: string, attrs: Map<string, string>): Rec | undefined {
	const node = nodeRecord(name);
	if (node !== undefined) {
		return node;
	}
	return simpleRecord(name, attrs) ?? textRecord(name);
}

/**
 * A text-bearing element the model reads directly.
 * VARIATION-POINT, ELEMENTS, CONTAINERS, PARAMETER-VALUES, REFERENCE-VALUES,
 * SUB-CONTAINERS and other structural elements are traversed but not recorded;
 * their contents attach to the nearest enclosing node.
 */
function textRecord(name: string): Rec | undefined {
	return TEXT_TAGS.has(name) ? recordOf('text', name) : undefined;
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

/** The short name of one ancestor record of `kind`, when it has one. */
function ancestorShortName(entry: Entry, kind: RecKind): string | undefined {
	const rec = entry.rec;
	return rec?.kind === kind && rec.shortName ? rec.shortName : undefined;
}

/** Short names of ancestor records of one kind, outermost first. */
function ancestorShortNames(ancestors: Entry[], kind: RecKind): string[] {
	const out: string[] = [];
	for (const entry of ancestors) {
		const name = ancestorShortName(entry, kind);
		if (name !== undefined) {
			out.push(name);
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

/** Which enclosing element decides a `<VALUE>`. */
function valueRole(stack: Entry[]): 'param' | 'pb' | undefined {
	const parent = parentName(stack);
	return paramRole(parent) ?? pbRole(parent);
}

/** The name of the innermost open element. */
function parentName(stack: Entry[]): string | undefined {
	return stack[stack.length - 1]?.name;
}

function paramRole(parent: string | undefined): 'param' | undefined {
	if (parent === 'ECUC-NUMERICAL-PARAM-VALUE' || parent === 'ECUC-TEXTUAL-PARAM-VALUE') {
		return 'param';
	}
	return undefined;
}

function pbRole(parent: string | undefined): 'pb' | undefined {
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

/** Skips `<!DOCTYPE …>` including an internal subset in brackets. */
function skipMarkupDeclaration(src: string, at: number): number {
	const end = markupDeclarationEnd(src, at);
	return end < 0 ? src.length : end;
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
