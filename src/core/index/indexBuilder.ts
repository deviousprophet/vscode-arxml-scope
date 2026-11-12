/**
 * Consumes XML stream events and builds one file's index contribution.
 *
 * The builder keeps a stack of open elements. Only the frames on that stack hold
 * text, and only for the small set of tags the index needs, so peak memory is
 * bounded by nesting depth plus the emitted records rather than by the file
 * size.
 */
import type { Range } from '../ecuc/model';
import { schemaReleaseFrom } from '../ecuc/schemaRelease';
import { LineStartBuilder } from '../text/offsets';
import { decodeXml } from '../text/xmlText';
import type { FileIndex, IndexDefinition, IndexElement, IndexReference } from './indexModel';
import { XmlStreamParser } from './xmlStream';
import type { XmlStreamHandlers } from './xmlStream';

const MODULE_VALUES = 'ECUC-MODULE-CONFIGURATION-VALUES';
const CONTAINER_VALUE = 'ECUC-CONTAINER-VALUE';
const PARAMETER_VALUES = new Set(['ECUC-NUMERICAL-PARAM-VALUE', 'ECUC-TEXTUAL-PARAM-VALUE']);
const REFERENCE_VALUES = new Set(['ECUC-REFERENCE-VALUE', 'ECUC-INSTANCE-REFERENCE-VALUE']);
const MODULE_DEF = 'ECUC-MODULE-DEF';
const ENUM_DEF = 'ECUC-ENUMERATION-PARAM-DEF';
const ENUM_LITERAL_DEF = 'ECUC-ENUMERATION-LITERAL-DEF';
const TEXT_TAGS = new Set([
	'SHORT-NAME',
	'DEFINITION-REF',
	'UUID',
	'VALUE-REF',
	'TARGET-REF',
	'CONTEXT-ELEMENT-REF',
	'LOWER-LIMIT',
	'UPPER-LIMIT',
	'MIN',
	'MAX',
	'MIN-LENGTH',
	'MAX-LENGTH',
	'DEFAULT-VALUE',
	'DESTINATION-REF',
	'LOWER-MULTIPLICITY',
	'UPPER-MULTIPLICITY',
	'UPPER-MULTIPLICITY-INFINITE',
	'WITH-AUTO',
	'SW-SYSCOND',
	'L-2',
	'VALUE',
]);

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a, allocation-free. */
function hashText(hash: number, text: string): number {
	let value = hash >>> 0;
	for (let at = 0; at < text.length; at++) {
		value = Math.imul(value ^ text.charCodeAt(at), FNV_PRIME) >>> 0;
	}
	return value;
}

/** Sorted attributes, `UUID` excluded: split copies differ only by UUID. */
function attributeSignature(attrs: ReadonlyMap<string, string>): string {
	const parts: string[] = [];
	for (const key of [...attrs.keys()].sort()) {
		if (key === 'UUID') {
			continue;
		}
		parts.push(key + '=' + attrs.get(key));
	}
	return parts.join('\u0001');
}

function normalizeSpace(text: string): string {
	return text.replace(/\s+/g, ' ');
}

interface Frame {
	name: string;
	start: number;
	text: string;
	/** Structural hash of everything seen inside this frame so far. */
	hash: number;
	/** Attributes of the element that opened the frame, when the index needs them. */
	attrs?: ReadonlyMap<string, string>;
	shortName?: string;
	definitionRef?: string;
	definitionDest?: string;
	uuid?: string;
	/** Normalized own `VARIATION-POINT/SW-SYSCOND` text, when present. */
	syscond?: string;
	/** Raw definition metadata, harvested as the definition's children close. */
	definition?: Partial<IndexDefinition>;
	/** Enumeration literals collected from `ECUC-ENUMERATION-LITERAL-DEF`. */
	literals?: string[];
	/** Reference target and context. */
	targetRawPath?: string;
	targetDest?: string;
	contextPaths?: string[];
	/** Parameter `<VALUE>` text. */
	value?: string;
}

/** Applies one text-tag body to the frames that own it. */
type TextAttacher = (frame: Frame, text: string, ancestors: Frame[]) => void;

/** One `DEFINITION-*` metadata field setter. */
type DefinitionFieldSetter = (definition: Partial<IndexDefinition>, text: string) => void;

/** Builds one `FileIndex` from chunk writes or one complete string. */
export class IndexBuilder implements XmlStreamHandlers {
	private readonly parser: XmlStreamParser;
	private readonly stack: Frame[] = [];
	private readonly file: FileIndex;
	private readonly lines = new LineStartBuilder();
	private lastEnd = 0;

	constructor(uri: string) {
		this.file = {
			uri,
			packages: [],
			elements: [],
			references: [],
			definitions: [],
		};
		this.parser = new XmlStreamParser(this);
	}

	/** Feeds one decoded text chunk. */
	write(chunk: string): void {
		this.lines.write(chunk);
		this.parser.write(chunk);
	}

	/** Ends the stream and returns the completed contribution. */
	finish(): FileIndex {
		this.parser.end();
		const end = this.lastEnd;
		while (this.stack.length > 0) {
			const frame = this.stack.pop()!;
			this.finishFrame(frame, end, this.stack);
		}
		this.file.lineStarts = this.lines.finish();
		return this.file;
	}

	open(name: string, attrs: ReadonlyMap<string, string>, offset: number): void {
		this.stack.push(newFrame(name, attrs, offset));
		this.recordDocumentAttributes(name, attrs);
	}

	/** Reads the document-level facts an opening tag carries. */
	private recordDocumentAttributes(name: string, attrs: ReadonlyMap<string, string>): void {
		if (name !== 'AUTOSAR') {
			return;
		}
		const release = schemaReleaseFrom(attrs.get('schemaLocation') ?? '');
		if (release !== undefined) {
			this.file.schemaRelease = release;
		}
	}

	close(name: string, offset: number): void {
		this.lastEnd = offset;
		const at = this.frameIndex(name);
		if (at < 0) {
			return;
		}
		this.closeFrom(at, offset);
	}

	/** Finishes the frames from `at` upwards, innermost first. */
	private closeFrom(at: number, offset: number): void {
		const closing = this.stack.splice(at);
		for (let i = closing.length - 1; i >= 0; i--) {
			this.finishFrame(closing[i], offset, this.stack);
		}
	}

	/** The index of the innermost open frame named `name`, or -1. */
	private frameIndex(name: string): number {
		for (let i = this.stack.length - 1; i >= 0; i--) {
			if (this.stack[i].name === name) {
				return i;
			}
		}
		return -1;
	}

	text(raw: string): void {
		const frame = this.stack[this.stack.length - 1];
		if (!frame || !TEXT_TAGS.has(frame.name)) {
			return;
		}
		frame.text += raw;
	}

	private finishFrame(frame: Frame, end: number, ancestors: Frame[]): void {
		if (TEXT_TAGS.has(frame.name)) {
			this.finishTextFrame(frame, ancestors);
			return;
		}
		this.recordFrame(frame, { start: frame.start, end }, ancestors);
		inheritHash(frame, ancestors);
	}

	/** Decodes a text tag's body, folds it into the parent hash and attaches it. */
	private finishTextFrame(frame: Frame, ancestors: Frame[]): void {
		const text = decodeXml(frame.text).trim();
		const parent = ancestors[ancestors.length - 1];
		if (parent !== undefined && frame.name !== 'UUID') {
			parent.hash = hashText(parent.hash, '\u0001' + frame.name + '=' + normalizeSpace(text));
		}
		this.attachText(frame, text, ancestors);
	}

	private recordFrame(frame: Frame, range: Range, ancestors: Frame[]): void {
		if (this.recordDefinitionFrame(frame, range, ancestors)) {
			return;
		}
		this.recordValueFrame(frame, range, ancestors);
	}

	/** Records package/definition frames; false when the frame is a value element. */
	private recordDefinitionFrame(frame: Frame, range: Range, ancestors: Frame[]): boolean {
		if (frame.name === 'AR-PACKAGE') {
			this.recordPackage(frame, ancestors);
			return true;
		}
		if (frame.name === ENUM_LITERAL_DEF) {
			recordEnumLiteral(frame, ancestors);
			return true;
		}
		if (isDefinitionKind(frame.name)) {
			this.pushDefinition(frame, range, ancestors);
			return true;
		}
		return false;
	}

	private recordPackage(frame: Frame, ancestors: Frame[]): void {
		const path = joinPath([...this.packageChain(ancestors), frame.shortName]);
		if (path && !this.file.packages.includes(path)) {
			this.file.packages.push(path);
		}
	}

	private recordValueFrame(frame: Frame, range: Range, ancestors: Frame[]): void {
		if (isContainerValues(frame.name)) {
			this.pushElement(frame, range, ancestors);
			return;
		}
		if (PARAMETER_VALUES.has(frame.name)) {
			this.pushParameterValue(frame, range, ancestors);
			return;
		}
		if (REFERENCE_VALUES.has(frame.name)) {
			this.pushReferenceValue(frame, range, ancestors);
		}
	}

	private attachText(frame: Frame, text: string, ancestors: Frame[]): void {
		const attach = TEXT_ATTACHERS.get(frame.name);
		if (attach === undefined) {
			return;
		}
		attach(frame, text, ancestors);
	}

	/** `attrs` are read on the text element itself, so the parent carries them. */
	private pushElement(frame: Frame, range: Range, ancestors: Frame[]): void {
		const element: IndexElement = {
			kind: frame.name === MODULE_VALUES ? 'module' : 'container',
			file: this.file.uri,
			range,
		};
		withElementPath(element, frame, this.pathFor(frame, ancestors));
		withElementMetadata(element, frame);
		this.file.elements.push(element);
	}

	private pushParameterValue(frame: Frame, range: Range, ancestors: Frame[]): void {
		this.file.elements.push(parameterElement(this.file.uri, frame, range, this.containerPath(ancestors)));
	}

	private pushReferenceValue(frame: Frame, range: Range, ancestors: Frame[]): void {
		this.file.references.push(referenceRecord(this.file.uri, frame, range, this.containerPath(ancestors)));
	}

	private pushDefinition(frame: Frame, range: Range, ancestors: Frame[]): void {
		const path = this.definitionPath(frame, ancestors);
		const shortName = frame.shortName;
		if (!path || !shortName) {
			return;
		}
		this.file.definitions.push(definitionRecord(this.file.uri, frame, path, shortName, range));
	}

	private pathFor(frame: Frame, ancestors: Frame[]): string | undefined {
		const packages = this.packageChain(ancestors);
		const module = nearest(ancestors, (f) => f.name === MODULE_VALUES);
		if (frame.name === MODULE_VALUES) {
			return joinPath([...packages, frame.shortName]);
		}
		const containers = ancestors
			.filter((f) => f.name === CONTAINER_VALUE)
			.map((f) => f.shortName)
			.filter((name): name is string => name !== undefined && name !== '');
		return joinPath([...packages, module?.shortName, ...containers, frame.shortName]);
	}

	private definitionPath(frame: Frame, ancestors: Frame[]): string | undefined {
		const packages = this.packageChain(ancestors);
		const parents = ancestors
			.filter((f) => f.name === MODULE_DEF || isContainerDef(f.name))
			.map((f) => f.shortName)
			.filter((name): name is string => name !== undefined && name !== '');
		return joinPath([...packages, ...parents, frame.shortName]);
	}

	private containerPath(ancestors: Frame[]): string | undefined {
		const container = nearest(ancestors, (f) => f.name === CONTAINER_VALUE);
		if (container) {
			const at = ancestors.indexOf(container);
			return this.pathFor(container, ancestors.slice(0, at));
		}
		const module = nearest(ancestors, (f) => f.name === MODULE_VALUES);
		if (module) {
			const at = ancestors.indexOf(module);
			return this.pathFor(module, ancestors.slice(0, at));
		}
		return undefined;
	}

	private packageChain(ancestors: Frame[]): string[] {
		return ancestors
			.filter((f) => f.name === 'AR-PACKAGE')
			.map((f) => f.shortName)
			.filter((name): name is string => name !== undefined && name !== '');
	}
}

/** Indexes one complete document. Convenience for tests and small callers. */
export function buildFileIndex(uri: string, text: string): FileIndex {
	const builder = new IndexBuilder(uri);
	builder.write(text);
	return builder.finish();
}

/** Indexes one document supplied in explicit chunks. */
export function buildFileIndexChunked(uri: string, chunks: readonly string[]): FileIndex {
	const builder = new IndexBuilder(uri);
	for (const chunk of chunks) {
		builder.write(chunk);
	}
	return builder.finish();
}

/** One new frame, with the attributes and UUID the index keeps for this tag. */
function newFrame(name: string, attrs: ReadonlyMap<string, string>, offset: number): Frame {
	const frame: Frame = {
		name,
		start: offset,
		text: '',
		hash: hashText(hashText(FNV_OFFSET, '<' + name), attributeSignature(attrs)),
	};
	if (keepsAttributes(name)) {
		frame.attrs = attrs;
	}
	const uuid = ownedUuid(name, attrs);
	if (uuid !== undefined) {
		frame.uuid = uuid;
	}
	return frame;
}

/** The text tags whose own attributes matter: `DEST` is read from them later. */
function keepsAttributes(name: string): boolean {
	return name === 'DEFINITION-REF' || name === 'VALUE-REF' || name === 'TARGET-REF' || name === 'DESTINATION-REF';
}

/** The `UUID` attribute when this tag may own one, else `undefined`. */
function ownedUuid(name: string, attrs: ReadonlyMap<string, string>): string | undefined {
	const uuid = attrs.get('UUID');
	if (uuid === undefined || uuid === '') {
		return undefined;
	}
	return canOwnUuid(name) ? uuid : undefined;
}

/** The `DEST` attribute of a text tag, when it carries a non-empty one. */
function destAttribute(frame: Frame): string | undefined {
	const dest = frame.attrs?.get('DEST');
	return dest === undefined || dest === '' ? undefined : dest;
}

/** Folds a closing child's hash into its immediate parent. */
function inheritHash(frame: Frame, ancestors: Frame[]): void {
	const parent = ancestors[ancestors.length - 1];
	if (parent !== undefined) {
		parent.hash = hashText(parent.hash, '\u0002' + frame.hash.toString(36));
	}
}

/** The parameter value record for one closed value frame. */
function parameterElement(file: string, frame: Frame, range: Range, sourcePath: string | undefined): IndexElement {
	const element: IndexElement = {
		kind: 'parameter',
		definitionRef: frame.definitionRef,
		definitionDest: frame.definitionDest,
		file,
		range,
	};
	withSourcePath(element, sourcePath);
	return withParameterText(element, frame);
}

function withSourcePath(element: IndexElement, sourcePath: string | undefined): IndexElement {
	if (sourcePath !== undefined) {
		element.sourcePath = sourcePath;
	}
	return element;
}

function withParameterText(element: IndexElement, frame: Frame): IndexElement {
	if (frame.uuid !== undefined) {
		element.uuid = frame.uuid;
	}
	if (frame.value !== undefined) {
		element.value = frame.value;
	}
	if (frame.syscond !== undefined) {
		element.syscond = frame.syscond;
	}
	return element;
}

/** The reference value record for one closed reference frame. */
function referenceRecord(file: string, frame: Frame, range: Range, sourcePath: string | undefined): IndexReference {
	const reference: IndexReference = {
		kind: 'reference',
		definitionRef: frame.definitionRef,
		definitionDest: frame.definitionDest,
		targetRawPath: frame.targetRawPath,
		targetDest: frame.targetDest,
		contextPaths: frame.contextPaths ?? [],
		file,
		range,
	};
	withReferenceIdentity(reference, frame);
	return withReferenceContext(reference, frame, sourcePath);
}

function withReferenceIdentity(reference: IndexReference, frame: Frame): IndexReference {
	if (frame.shortName !== undefined) {
		reference.shortName = frame.shortName;
	}
	if (frame.uuid !== undefined) {
		reference.uuid = frame.uuid;
	}
	return reference;
}

function withReferenceContext(reference: IndexReference, frame: Frame, sourcePath: string | undefined): IndexReference {
	if (frame.syscond !== undefined) {
		reference.syscond = frame.syscond;
	}
	if (sourcePath) {
		reference.sourcePath = sourcePath;
	}
	return reference;
}

/** The definition record for one closed definition frame. */
function definitionRecord(
	file: string,
	frame: Frame,
	path: string,
	shortName: string,
	range: Range
): IndexDefinition {
	const definition: IndexDefinition = {
		path,
		kind: frame.name,
		shortName,
		file,
		range,
		...(frame.definition ?? {}),
	};
	return withDefinitionLiterals(definition, frame.literals);
}

function withDefinitionLiterals(definition: IndexDefinition, literals: string[] | undefined): IndexDefinition {
	if (literals !== undefined && literals.length > 0) {
		definition.literals = literals;
	}
	return definition;
}

function withElementPath(element: IndexElement, frame: Frame, path: string | undefined): IndexElement {
	if (path) {
		element.path = path;
	}
	if (frame.shortName !== undefined) {
		element.shortName = frame.shortName;
	}
	if (frame.definitionRef !== undefined) {
		element.definitionRef = frame.definitionRef;
	}
	return element;
}

function withElementMetadata(element: IndexElement, frame: Frame): IndexElement {
	if (frame.definitionDest !== undefined) {
		element.definitionDest = frame.definitionDest;
	}
	if (frame.uuid !== undefined) {
		element.uuid = frame.uuid;
	}
	return withElementHash(element, frame);
}

function withElementHash(element: IndexElement, frame: Frame): IndexElement {
	if (isPathElement(element.kind)) {
		element.contentHash = frame.hash;
	}
	if (frame.syscond !== undefined) {
		element.syscond = frame.syscond;
	}
	return element;
}

/** True for the elements that carry an AR path and a content hash. */
function isPathElement(kind: IndexElement['kind']): boolean {
	return kind === 'module' || kind === 'container';
}

function recordEnumLiteral(frame: Frame, ancestors: Frame[]): void {
	const parent = nearest(ancestors, isEnumDefinition);
	if (parent !== undefined && frame.shortName) {
		(parent.literals ??= []).push(frame.shortName);
	}
}

function attachShortName(frame: Frame, text: string, ancestors: Frame[]): void {
	const parent = ancestors[ancestors.length - 1];
	if (parent !== undefined && knowsShortName(parent.name)) {
		parent.shortName = text;
	}
}

function attachDefinitionRef(frame: Frame, text: string, ancestors: Frame[]): void {
	const parent = ancestors[ancestors.length - 1];
	if (parent === undefined || !isDefinitionOwner(parent.name)) {
		return;
	}
	parent.definitionRef = text;
	const dest = destAttribute(frame);
	if (dest !== undefined) {
		parent.definitionDest = dest;
	}
}

function attachUuid(frame: Frame, text: string, ancestors: Frame[]): void {
	const parent = ancestors[ancestors.length - 1];
	if (parent !== undefined && isDefinitionOwner(parent.name)) {
		parent.uuid = text;
	}
}

function attachTargetRef(frame: Frame, text: string, ancestors: Frame[]): void {
	const parent = nearest(ancestors, isReferenceValue);
	if (parent !== undefined) {
		parent.targetRawPath = text;
		parent.targetDest = frame.attrs?.get('DEST');
	}
}

function attachContextElementRef(frame: Frame, text: string, ancestors: Frame[]): void {
	const parent = nearest(ancestors, isReferenceValue);
	if (parent !== undefined) {
		(parent.contextPaths ??= []).push(text);
	}
}

function attachDestinationRef(frame: Frame, text: string, ancestors: Frame[]): void {
	const parent = nearest(ancestors, isDefinitionFrame);
	if (parent === undefined) {
		return;
	}
	setDefinitionField(parent, frame.name, text);
	const dest = destAttribute(frame);
	if (dest !== undefined) {
		(parent.definition ??= {}).destinationDest = dest;
	}
}

function attachParameterValue(frame: Frame, text: string, ancestors: Frame[]): void {
	const parent = ancestors[ancestors.length - 1];
	if (parent !== undefined && PARAMETER_VALUES.has(parent.name)) {
		parent.value = text;
	}
}

function attachSyscond(frame: Frame, text: string, ancestors: Frame[]): void {
	const owner = nearest(ancestors, ownsSyscond);
	if (owner !== undefined) {
		owner.syscond = appendSyscond(owner.syscond, normalizeSpace(text));
	}
}

function appendSyscond(current: string | undefined, guard: string): string {
	return current === undefined ? guard : current + ' && ' + guard;
}

function attachWithAuto(frame: Frame, text: string, ancestors: Frame[]): void {
	const parent = ancestors[ancestors.length - 1];
	if (parent !== undefined && isDefinitionKind(parent.name)) {
		(parent.definition ??= {}).withAuto = /^true$/i.test(text);
	}
}

function attachLiteralDescription(frame: Frame, text: string, ancestors: Frame[]): void {
	const owner = nearest(ancestors, isDescriptionOwner);
	if (owner === undefined || !isDefinitionKind(owner.name)) {
		return;
	}
	setDefinitionField(owner, frame.name, text);
}

function attachDefinitionField(frame: Frame, text: string, ancestors: Frame[]): void {
	const parent = nearest(ancestors, isDefinitionFrame);
	if (parent !== undefined) {
		setDefinitionField(parent, frame.name, text);
	}
}

const TEXT_ATTACHERS = new Map<string, TextAttacher>([
	['SHORT-NAME', attachShortName],
	['DEFINITION-REF', attachDefinitionRef],
	['UUID', attachUuid],
	['VALUE-REF', attachTargetRef],
	['TARGET-REF', attachTargetRef],
	['CONTEXT-ELEMENT-REF', attachContextElementRef],
	['DESTINATION-REF', attachDestinationRef],
	['VALUE', attachParameterValue],
	['SW-SYSCOND', attachSyscond],
	['WITH-AUTO', attachWithAuto],
	['L-2', attachLiteralDescription],
	['LOWER-LIMIT', attachDefinitionField],
	['UPPER-LIMIT', attachDefinitionField],
	['MIN', attachDefinitionField],
	['MAX', attachDefinitionField],
	['MIN-LENGTH', attachDefinitionField],
	['MAX-LENGTH', attachDefinitionField],
	['DEFAULT-VALUE', attachDefinitionField],
	['LOWER-MULTIPLICITY', attachDefinitionField],
	['UPPER-MULTIPLICITY', attachDefinitionField],
	['UPPER-MULTIPLICITY-INFINITE', attachDefinitionField],
]);

function knowsShortName(name: string): boolean {
	return isValueElement(name) || name === ENUM_LITERAL_DEF || knowsDefinition(name) || isDefinitionKind(name);
}

/** Elements that open a value subtree under a package. */
function isValueElement(name: string): boolean {
	return name === 'AR-PACKAGE' || name === MODULE_VALUES || name === CONTAINER_VALUE;
}

/** Elements that can carry an AUTOSAR `UUID` attribute or child. */
function canOwnUuid(name: string): boolean {
	return name === 'AR-PACKAGE' || name === ENUM_LITERAL_DEF || knowsDefinition(name) || isDefinitionKind(name);
}

function knowsDefinition(name: string): boolean {
	return name === MODULE_VALUES || name === CONTAINER_VALUE || PARAMETER_VALUES.has(name) || REFERENCE_VALUES.has(name);
}

/** True for any ECUC definition element that can carry a SHORT-NAME and be referenced. */
function isDefinitionKind(name: string): boolean {
	return isStructuralDefinition(name) || isParamDefinition(name);
}

function isStructuralDefinition(name: string): boolean {
	return name === MODULE_DEF || isContainerDef(name);
}

function isParamDefinition(name: string): boolean {
	return (
		/^ECUC-[A-Z0-9-]+-PARAM-DEF$/.test(name) ||
		/-REFERENCE-DEF$/.test(name) ||
		name === 'ECUC-FUNCTION-NAME-DEF' ||
		name === 'ECUC-LINKER-SYMBOL-DEF'
	);
}

/** A container definition nests further definitions and contributes a path segment. */
function isContainerDef(name: string): boolean {
	return name.endsWith('-CONTAINER-DEF');
}

/** True for a value element that a parameter or reference can live under. */
function isContainerValues(name: string): boolean {
	return name === MODULE_VALUES || name === CONTAINER_VALUE;
}

/** True for the parents that own a `DEFINITION-REF`/`UUID` text body. */
function isDefinitionOwner(name: string): boolean {
	return knowsDefinition(name) || isDefinitionKind(name);
}

function isDefinitionFrame(frame: Frame): boolean {
	return isDefinitionKind(frame.name);
}

function isReferenceValue(frame: Frame): boolean {
	return REFERENCE_VALUES.has(frame.name);
}

function isEnumDefinition(frame: Frame): boolean {
	return frame.name === ENUM_DEF;
}

/** The nearest value element that owns its own `SW-SYSCOND` guard. */
function ownsSyscond(frame: Frame): boolean {
	return (
		frame.name === MODULE_VALUES ||
		frame.name === CONTAINER_VALUE ||
		PARAMETER_VALUES.has(frame.name) ||
		REFERENCE_VALUES.has(frame.name)
	);
}

/** A `DESC/L-2` may belong to a definition or to one enumeration literal. */
function isDescriptionOwner(frame: Frame): boolean {
	return isDefinitionKind(frame.name) || frame.name === ENUM_LITERAL_DEF;
}

function nearest(frames: readonly Frame[], predicate: (frame: Frame) => boolean): Frame | undefined {
	for (let i = frames.length - 1; i >= 0; i--) {
		if (predicate(frames[i])) {
			return frames[i];
		}
	}
	return undefined;
}

function setDefinitionField(frame: Frame, tag: string, text: string): void {
	const definition = (frame.definition ??= {});
	const set = DEFINITION_FIELDS.get(tag);
	if (set === undefined) {
		return;
	}
	set(definition, text);
}

const DEFINITION_FIELDS = new Map<string, DefinitionFieldSetter>([
	['LOWER-LIMIT', (definition, text) => { definition.lowerLimit = text; }],
	['UPPER-LIMIT', (definition, text) => { definition.upperLimit = text; }],
	['MIN', (definition, text) => { definition.minValue = text; }],
	['MAX', (definition, text) => { definition.maxValue = text; }],
	['MIN-LENGTH', (definition, text) => { definition.minLength = text; }],
	['MAX-LENGTH', (definition, text) => { definition.maxLength = text; }],
	['DEFAULT-VALUE', (definition, text) => { definition.defaultValue = text; }],
	['DESTINATION-REF', (definition, text) => { definition.destinationRef = text; }],
	['LOWER-MULTIPLICITY', (definition, text) => { definition.lowerMultiplicity = text; }],
	['UPPER-MULTIPLICITY', (definition, text) => { definition.upperMultiplicity = text; }],
	['UPPER-MULTIPLICITY-INFINITE', (definition, text) => { definition.upperMultiplicityInfinite = /^true$/i.test(text); }],
	['L-2', setDescription],
]);

/** The first `L-2` wins; a literal description never overwrites a definition's. */
function setDescription(definition: Partial<IndexDefinition>, text: string): void {
	if (definition.description === undefined) {
		definition.description = text;
	}
}

function joinPath(parts: readonly (string | undefined)[]): string | undefined {
	const clean = parts.filter((part): part is string => part !== undefined && part !== '');
	return clean.length === 0 ? undefined : '/' + clean.join('/');
}
