/**
 * Consumes XML stream events and builds one file's index contribution.
 *
 * The builder keeps a stack of open elements. Only the frames on that stack hold
 * text, and only for the small set of tags the index needs, so peak memory is
 * bounded by nesting depth plus the emitted records rather than by the file
 * size.
 */
import type { Range } from '../ecuc/model';
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
	'L-2',
	'VALUE',
]);

interface Frame {
	name: string;
	start: number;
	text: string;
	/** Attributes of the element that opened the frame, when the index needs them. */
	attrs?: ReadonlyMap<string, string>;
	shortName?: string;
	definitionRef?: string;
	definitionDest?: string;
	uuid?: string;
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

/** Builds one `FileIndex` from chunk writes or one complete string. */
export class IndexBuilder implements XmlStreamHandlers {
	private readonly parser: XmlStreamParser;
	private readonly stack: Frame[] = [];
	private readonly file: FileIndex;
	private lastEnd = 0;
	private offset = 0;

	constructor(uri: string) {
		this.file = {
			uri,
			packages: [],
			lineStarts: [0],
			elements: [],
			references: [],
			definitions: [],
		};
		this.parser = new XmlStreamParser(this);
	}

	/** Feeds one decoded text chunk. */
	write(chunk: string): void {
		for (let at = 0; at < chunk.length; at++) {
			if (chunk[at] === '\n') {
				this.file.lineStarts!.push(this.offset + at + 1);
			}
		}
		this.offset += chunk.length;
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
		return this.file;
	}

	open(name: string, attrs: ReadonlyMap<string, string>, offset: number): void {
		const frame: Frame = { name, start: offset, text: '' };
		if (name === 'DEFINITION-REF' || name === 'VALUE-REF' || name === 'TARGET-REF' || name === 'DESTINATION-REF') {
			frame.attrs = attrs;
		}
		const uuid = attrs.get('UUID');
		if (uuid !== undefined && uuid !== '' && canOwnUuid(name)) {
			frame.uuid = uuid;
		}
		this.stack.push(frame);
		if (name === 'AUTOSAR') {
			const release = schemaReleaseFrom(attrs.get('schemaLocation') ?? '');
			if (release !== undefined) {
				this.file.schemaRelease = release;
			}
		}
	}

	close(name: string, offset: number): void {
		this.lastEnd = offset;
		let at = -1;
		for (let i = this.stack.length - 1; i >= 0; i--) {
			if (this.stack[i].name === name) {
				at = i;
				break;
			}
		}
		if (at < 0) {
			return;
		}
		const closing = this.stack.splice(at);
		for (let i = closing.length - 1; i >= 0; i--) {
			this.finishFrame(closing[i], offset, this.stack);
		}
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
			this.attachText(frame, ancestors);
			return;
		}
		const range: Range = { start: frame.start, end };
		if (frame.name === 'AR-PACKAGE') {
			const path = joinPath([...this.packageChain(ancestors), frame.shortName]);
			if (path && !this.file.packages.includes(path)) {
				this.file.packages.push(path);
			}
			return;
		}
		if (frame.name === ENUM_LITERAL_DEF) {
			const parent = nearest(ancestors, (f) => f.name === ENUM_DEF);
			if (parent && frame.shortName) {
				(parent.literals ??= []).push(frame.shortName);
			}
			return;
		}
		if (isDefinitionKind(frame.name)) {
			this.pushDefinition(frame, range, ancestors);
			return;
		}
		if (frame.name === MODULE_VALUES || frame.name === CONTAINER_VALUE) {
			this.pushElement(frame, range, ancestors);
			return;
		}
		if (PARAMETER_VALUES.has(frame.name)) {
			const sourcePath = this.containerPath(ancestors);
			this.file.elements.push({
				kind: 'parameter',
				definitionRef: frame.definitionRef,
				definitionDest: frame.definitionDest,
				...(sourcePath === undefined ? {} : { sourcePath }),
				...(frame.uuid === undefined ? {} : { uuid: frame.uuid }),
				...(frame.value === undefined ? {} : { value: frame.value }),
				file: this.file.uri,
				range,
			});
			return;
		}
		if (REFERENCE_VALUES.has(frame.name)) {
			const reference: IndexReference = {
				kind: 'reference',
				definitionRef: frame.definitionRef,
				definitionDest: frame.definitionDest,
				...(frame.shortName === undefined ? {} : { shortName: frame.shortName }),
				...(frame.uuid === undefined ? {} : { uuid: frame.uuid }),
				targetRawPath: frame.targetRawPath,
				targetDest: frame.targetDest,
				contextPaths: frame.contextPaths ?? [],
				file: this.file.uri,
				range,
			};
			const sourcePath = this.containerPath(ancestors);
			if (sourcePath) {
				reference.sourcePath = sourcePath;
			}
			this.file.references.push(reference);
			return;
		}
	}

	private attachText(frame: Frame, ancestors: Frame[]): void {
		const raw = frame.text;
		const text = decodeXml(raw).trim();
		switch (frame.name) {
			case 'SHORT-NAME': {
				const parent = ancestors[ancestors.length - 1];
				if (parent && knowsShortName(parent.name)) {
					parent.shortName = text;
				}
				return;
			}
			case 'DEFINITION-REF': {
				const parent = ancestors[ancestors.length - 1];
				if (!parent || !(knowsDefinition(parent.name) || isDefinitionKind(parent.name))) {
					return;
				}
				parent.definitionRef = text;
				const dest = frame.attrs?.get('DEST');
				if (dest !== undefined && dest !== '') {
					parent.definitionDest = dest;
				}
				return;
			}
			case 'UUID': {
				const parent = ancestors[ancestors.length - 1];
				if (parent && (knowsDefinition(parent.name) || isDefinitionKind(parent.name))) {
					parent.uuid = text;
				}
				return;
			}
			case 'VALUE-REF':
			case 'TARGET-REF': {
				const parent = nearest(ancestors, (f) => REFERENCE_VALUES.has(f.name));
				if (parent) {
					parent.targetRawPath = raw.trim();
					parent.targetDest = frame.attrs?.get('DEST');
				}
				return;
			}
			case 'CONTEXT-ELEMENT-REF': {
				const parent = nearest(ancestors, (f) => REFERENCE_VALUES.has(f.name));
				if (parent) {
					(parent.contextPaths ??= []).push(raw.trim());
				}
				return;
			}
			case 'DESTINATION-REF': {
				const parent = nearest(ancestors, (f) => isDefinitionKind(f.name));
				if (parent) {
					setDefinitionField(parent, frame.name, text);
					const dest = frame.attrs?.get('DEST');
					if (dest !== undefined && dest !== '') {
						(parent.definition ??= {}).destinationDest = dest;
					}
				}
				return;
			}
			case 'VALUE': {
				const parent = ancestors[ancestors.length - 1];
				if (parent && PARAMETER_VALUES.has(parent.name)) {
					parent.value = text;
				}
				return;
			}
			case 'L-2': {
				// A literal's description belongs to the literal, not to the enclosing
				// enumeration definition; a literal is not a definition record of its own,
				// so its description is dropped rather than stolen.
				const owner = nearest(ancestors, (f) => isDefinitionKind(f.name) || f.name === ENUM_LITERAL_DEF);
				if (owner && !isDefinitionKind(owner.name)) {
					return;
				}
				if (owner) {
					setDefinitionField(owner, frame.name, text);
				}
				return;
			}
			case 'LOWER-LIMIT':
			case 'UPPER-LIMIT':
			case 'MIN':
			case 'MAX':
			case 'MIN-LENGTH':
			case 'MAX-LENGTH':
			case 'DEFAULT-VALUE':
			case 'LOWER-MULTIPLICITY':
			case 'UPPER-MULTIPLICITY':
			case 'UPPER-MULTIPLICITY-INFINITE': {
				const parent = nearest(ancestors, (f) => isDefinitionKind(f.name));
				if (parent) {
					setDefinitionField(parent, frame.name, text);
				}
				return;
			}
		}
	}

	/** `attrs` are read on the text element itself, so the parent carries them. */
	private pushElement(frame: Frame, range: Range, ancestors: Frame[]): void {
		const element: IndexElement = {
			kind: frame.name === MODULE_VALUES ? 'module' : 'container',
			file: this.file.uri,
			range,
		};
		const path = this.pathFor(frame, ancestors);
		if (path) {
			element.path = path;
		}
		if (frame.shortName !== undefined) {
			element.shortName = frame.shortName;
		}
		if (frame.definitionRef !== undefined) {
			element.definitionRef = frame.definitionRef;
		}
		if (frame.definitionDest !== undefined) {
			element.definitionDest = frame.definitionDest;
		}
		if (frame.uuid !== undefined) {
			element.uuid = frame.uuid;
		}
		this.file.elements.push(element);
	}

	private pushDefinition(frame: Frame, range: Range, ancestors: Frame[]): void {
		const path = this.definitionPath(frame, ancestors);
		if (!path || !frame.shortName) {
			return;
		}
		const definition: IndexDefinition = {
			path,
			kind: frame.name,
			shortName: frame.shortName,
			file: this.file.uri,
			range,
			...(frame.definition ?? {}),
		};
		if (frame.literals && frame.literals.length > 0) {
			definition.literals = frame.literals;
		}
		this.file.definitions.push(definition);
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

function knowsShortName(name: string): boolean {
	return (
		name === 'AR-PACKAGE' ||
		name === MODULE_VALUES ||
		name === CONTAINER_VALUE ||
		name === ENUM_LITERAL_DEF ||
		knowsDefinition(name) ||
		isDefinitionKind(name)
	);
}

/** Elements that can carry an AUTOSAR `UUID` attribute or child. */
function canOwnUuid(name: string): boolean {
	return name === 'AR-PACKAGE' || name === ENUM_LITERAL_DEF || knowsDefinition(name) || isDefinitionKind(name);
}

function knowsDefinition(name: string): boolean {
	return name === MODULE_VALUES || name === CONTAINER_VALUE || PARAMETER_VALUES.has(name) || REFERENCE_VALUES.has(name);
}

/** True for any ECUC definition element that can carry a SHORT-NAME and be referenced. */
function isDefinitionKind(name: string): boolean {	if (name === MODULE_DEF || isContainerDef(name)) {
		return true;
	}
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
	switch (tag) {
		case 'LOWER-LIMIT':
			definition.lowerLimit = text;
			return;
		case 'UPPER-LIMIT':
			definition.upperLimit = text;
			return;
		case 'MIN':
			definition.minValue = text;
			return;
		case 'MAX':
			definition.maxValue = text;
			return;
		case 'MIN-LENGTH':
			definition.minLength = text;
			return;
		case 'MAX-LENGTH':
			definition.maxLength = text;
			return;
		case 'DEFAULT-VALUE':
			definition.defaultValue = text;
			return;
		case 'DESTINATION-REF':
			definition.destinationRef = text;
			return;
		case 'LOWER-MULTIPLICITY':
			definition.lowerMultiplicity = text;
			return;
		case 'UPPER-MULTIPLICITY':
			definition.upperMultiplicity = text;
			return;
		case 'UPPER-MULTIPLICITY-INFINITE':
			definition.upperMultiplicityInfinite = /^true$/i.test(text);
			return;
		case 'L-2':
			if (definition.description === undefined) {
				definition.description = text;
			}
			return;
	}
}

function joinPath(parts: readonly (string | undefined)[]): string | undefined {
	const clean = parts.filter((part): part is string => part !== undefined && part !== '');
	return clean.length === 0 ? undefined : '/' + clean.join('/');
}

/** Schema release from `xsi:schemaLocation`, same rule as the ECUC scanner. */
export function schemaReleaseFrom(schemaLocation: string): string | undefined {
	const tokens = schemaLocation.trim().split(/\s+/);
	const last = tokens[tokens.length - 1];
	if (!last) {
		return undefined;
	}
	const parts = last.split('.')[0].split('_');
	return parts[parts.length - 1].replace(/-/g, '.');
}
