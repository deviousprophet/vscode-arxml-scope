/**
 * Text-editor providers for ARXML: symbols, definition, references, links and
 * hover. They reuse the same scanner and workspace index as the custom editor;
 * the plain editor sees unsaved text because the document is the source here.
 */
import * as vscode from 'vscode';
import { isEcucValues } from '../core/ecuc/detect';
import { buildNodeIndex } from '../core/ecuc/nodeId';
import type { NodeEntry } from '../core/ecuc/nodeId';
import { scanEcucValues } from '../core/ecuc/scanner';
import { definitionInfo } from '../core/index/definitions';
import { buildFileIndex } from '../core/index/indexBuilder';
import { positionAt } from '../core/validation/position';
import { documentSymbols, refTokenAt, refTokens } from '../core/text/arxmlFeatures';
import { IndexService, indexSettings, isIndexableUri } from './indexService';
import { innermostNodeIdAt } from './navigation';
import type { EcucDocumentModel, Range } from '../core/ecuc/model';
import type { FileIndex, IndexDefinition, IndexElement } from '../core/index/indexModel';
import type { RefToken, SymbolData } from '../core/text/arxmlFeatures';

interface CachedDocument {
	version: number;
	model?: EcucDocumentModel;
	file?: FileIndex;
	oversized?: boolean;
	/** Derived scans, reused until the document version changes. */
	symbols?: SymbolData[];
	tokens?: RefToken[];
	/** Resolved links, keyed by the workspace index revision as well as the document. */
	links?: { revision: number; links: vscode.DocumentLink[] };
}

const SELECTOR: vscode.DocumentSelector = [{ pattern: '**/*.arxml' }];

class TextFeatures
	implements
		vscode.DocumentSymbolProvider,
		vscode.DefinitionProvider,
		vscode.ReferenceProvider,
		vscode.DocumentLinkProvider,
		vscode.HoverProvider
{
	private readonly cache = new Map<string, CachedDocument>();

	constructor(private readonly index: IndexService) {}

	provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
		if (!this.indexable(document)) {
			return [];
		}
		const data = this.cached(document);
		if (data.oversized === true) {
			return [];
		}
		return data.model === undefined
			? this.fileSymbols(document, data)
			: this.modelSymbols(document, data, data.model);
	}

	private modelSymbols(
		document: vscode.TextDocument,
		data: CachedDocument,
		model: EcucDocumentModel
	): vscode.DocumentSymbol[] {
		const symbols = data.symbols ?? documentSymbols(model);
		data.symbols = symbols;
		return symbols.map((symbol) => this.toSymbol(document, symbol));
	}

	private fileSymbols(document: vscode.TextDocument, data: CachedDocument): vscode.DocumentSymbol[] {
		const file = data.file ?? this.fileIndex(document);
		return file.definitions.map((definition) => this.definitionSymbol(document, definition));
	}

	private definitionSymbol(document: vscode.TextDocument, definition: IndexDefinition): vscode.DocumentSymbol {
		const range = this.range(document, definition.range);
		return new vscode.DocumentSymbol(
			definition.shortName,
			definition.path,
			symbolKindFor(definition.kind),
			range,
			range
		);
	}

	provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location | vscode.Location[] | undefined {
		if (!this.indexable(document)) {
			return undefined;
		}
		const token = this.tokenAt(document, position);
		if (token === undefined) {
			return undefined;
		}
		if (token.kind === 'definition') {
			return this.definitionLocation(token.rawPath);
		}
		return this.targetLocations(document, token);
	}

	private definitionLocation(rawPath: string): vscode.Location | undefined {
		const definition = this.index.workspaceIndex.definitionEntry(rawPath);
		return definition === undefined
			? undefined
			: new vscode.Location(vscode.Uri.parse(definition.file), this.rangeFor(definition.file, definition.range));
	}

	private targetLocations(
		document: vscode.TextDocument,
		token: RefToken
	): vscode.Location | vscode.Location[] | undefined {
		const resolution = this.index.resolveTarget(token.rawPath, token.dest, document.uri.toString());
		if (!resolution.ok || resolution.copies.length === 0) {
			return undefined;
		}
		const locations = resolution.copies.map((copy) => this.locationFor(copy.file, copy.range));
		return locations.length === 1 ? locations[0] : locations;
	}

	provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position
	): vscode.Location[] {
		if (!this.indexable(document)) {
			return [];
		}
		const data = this.cached(document);
		if (data.oversized === true) {
			return [];
		}
		const offset = document.offsetAt(position);
		if (data.model !== undefined) {
			return this.modelReferences(document, data.model, offset);
		}
		return this.fileReferences(data, offset);
	}

	private modelReferences(
		document: vscode.TextDocument,
		model: EcucDocumentModel,
		offset: number
	): vscode.Location[] {
		const token = refTokenAt(model, offset);
		if (token === undefined) {
			return this.entryReferences(document, model, offset);
		}
		if (token.kind === 'definition') {
			return this.definitionReferences(token.rawPath);
		}
		if (token.kind === 'target') {
			return this.targetReferences(document, token);
		}
		return this.entryReferences(document, model, offset);
	}

	private definitionReferences(rawPath: string): vscode.Location[] {
		return this.index
			.definitionUsers(rawPath)
			.map((user) => this.locationFor(user.file, user.range));
	}

	private targetReferences(document: vscode.TextDocument, token: RefToken): vscode.Location[] {
		const resolution = this.index.resolveTarget(token.rawPath, token.dest, document.uri.toString());
		if (!resolution.ok) {
			return [];
		}
		return resolution.copies.flatMap((copy) =>
			this.index
				.referencesFor(copy)
				.map((reference) => this.locationFor(reference.file, reference.range))
		);
	}

	private entryReferences(
		document: vscode.TextDocument,
		model: EcucDocumentModel,
		offset: number
	): vscode.Location[] {
		const nodeIndex = buildNodeIndex(model);
		const entryId = innermostNodeIdAt(nodeIndex, offset);
		const entry = entryId === undefined ? undefined : nodeIndex.byId.get(entryId);
		if (entry === undefined || entry.path === undefined) {
			return [];
		}
		return this.elementReferences(document, entry, entry.path);
	}

	private elementReferences(document: vscode.TextDocument, entry: NodeEntry, path: string): vscode.Location[] {
		const target: IndexElement = {
			kind: entry.kind === 'module' ? 'module' : 'container',
			path,
			file: document.uri.toString(),
			range: entry.range,
		};
		return this.index
			.referencesFor(target)
			.map((reference) => this.locationFor(reference.file, reference.range));
	}

	private fileReferences(data: CachedDocument, offset: number): vscode.Location[] {
		const definition = data.file === undefined ? undefined : definitionAt(data.file, offset);
		if (definition !== undefined) {
			return this.definitionReferences(definition.path);
		}
		return [];
	}

	private locationFor(file: string, range: Range): vscode.Location {
		return new vscode.Location(vscode.Uri.parse(file), this.rangeFor(file, range));
	}

	provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
		if (!this.indexable(document)) {
			return [];
		}
		const data = this.cached(document);
		if (data.model === undefined) {
			return [];
		}
		const revision = this.index.workspaceIndex.revision;
		const cachedLinks = this.cachedLinks(data, revision);
		return cachedLinks === undefined
			? this.buildLinks(document, data, data.model, revision)
			: cachedLinks;
	}

	private cachedLinks(data: CachedDocument, revision: number): vscode.DocumentLink[] | undefined {
		if (data.links === undefined) {
			return undefined;
		}
		return data.links.revision === revision ? data.links.links : undefined;
	}

	private buildLinks(
		document: vscode.TextDocument,
		data: CachedDocument,
		model: EcucDocumentModel,
		revision: number
	): vscode.DocumentLink[] {
		const tokens = data.tokens ?? refTokens(model);
		data.tokens = tokens;
		const links: vscode.DocumentLink[] = [];
		for (const token of tokens) {
			this.pushLink(links, token, document);
		}
		data.links = { revision, links };
		return links;
	}

	private pushLink(
		links: vscode.DocumentLink[],
		token: RefToken,
		document: vscode.TextDocument
	): void {
		const target = this.targetFor(token, document.uri.toString());
		if (target === undefined) {
			return;
		}
		const link = new vscode.DocumentLink(this.range(document, token.range));
		link.target = this.uriWithLine(target.file, target.range.start);
		link.tooltip = token.rawPath;
		links.push(link);
	}

	provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		if (!this.indexable(document)) {
			return undefined;
		}
		const token = this.tokenAt(document, position);
		if (token === undefined) {
			return undefined;
		}
		const target = this.tokenDescription(token, document.uri.toString());
		if (target === undefined) {
			return new vscode.Hover(new vscode.MarkdownString(`No indexed target for \`${token.rawPath}\`.`), this.range(document, token.range));
		}
		return new vscode.Hover(new vscode.MarkdownString(target), this.range(document, token.range));
	}

	private tokenAt(document: vscode.TextDocument, position: vscode.Position): RefToken | undefined {
		const data = this.cached(document);
		return data.model === undefined ? undefined : refTokenAt(data.model, document.offsetAt(position));
	}

	private tokenDescription(token: RefToken, sourceFile: string): string | undefined {
		if (token.kind === 'definition') {
			return this.definitionDescription(token.rawPath);
		}
		return this.targetDescription(token, sourceFile);
	}

	private definitionDescription(rawPath: string): string | undefined {
		const definition = this.index.workspaceIndex.definitionEntry(rawPath);
		if (definition === undefined) {
			return undefined;
		}
		const info = definitionInfo(definition);
		const lines = [`**${info.type}** \`${definition.path}\``];
		appendOptionalLine(lines, 'Range', info.range);
		appendOptionalLine(lines, 'Multiplicity', info.multiplicity);
		appendOptionalText(lines, info.description);
		lines.push(`_${info.fileName}_`);
		return lines.join('\n\n');
	}

	private targetDescription(token: RefToken, sourceFile: string): string | undefined {
		const resolution = this.index.resolveTarget(token.rawPath, token.dest, sourceFile);
		if (!resolution.ok) {
			return undefined;
		}
		const element = resolution.element;
		const lines = [`**Target** \`${element.path ?? token.rawPath}\``, `Kind: ${element.kind}`];
		if (resolution.copies.length > 1) {
			lines.push(`Copies: ${resolution.copies.map((copy) => copy.file.split('/').pop()).join(', ')}`);
		}
		this.appendDefinitionDetails(lines, element);
		return lines.join('\n\n');
	}

	private appendDefinitionDetails(lines: string[], element: IndexElement): void {
		const definition = element.definitionRef === undefined ? undefined : this.index.definition(element.definitionRef);
		if (definition === undefined) {
			return;
		}
		lines.push(`Type: ${definition.type}`);
		appendOptionalLine(lines, 'Range', definition.range);
		appendOptionalLine(lines, 'Multiplicity', definition.multiplicity);
		appendOptionalText(lines, definition.description);
	}

	private targetFor(token: RefToken, sourceFile: string): { file: string; range: Range } | undefined {
		return token.kind === 'definition'
			? this.definitionTarget(token.rawPath)
			: this.resolvedTarget(token, sourceFile);
	}

	private definitionTarget(rawPath: string): { file: string; range: Range } | undefined {
		if (this.index.workspaceIndex.definitionCandidateCount(rawPath) > 1) {
			return undefined;
		}
		const definition = this.index.workspaceIndex.definitionEntry(rawPath);
		return definition === undefined ? undefined : { file: definition.file, range: definition.range };
	}

	private resolvedTarget(
		token: RefToken,
		sourceFile: string
	): { file: string; range: Range } | undefined {
		const resolution = this.index.resolveTarget(token.rawPath, token.dest, sourceFile);
		return resolution.ok && resolution.copies.length === 1
			? { file: resolution.element.file, range: resolution.element.range }
			: undefined;
	}

	private toSymbol(document: vscode.TextDocument, symbol: SymbolData): vscode.DocumentSymbol {
		const result = new vscode.DocumentSymbol(
			symbol.name,
			symbol.detail ?? '',
			symbolKind(symbol.kind),
			this.range(document, symbol.range),
			this.range(document, symbol.selectionRange)
		);
		result.children = symbol.children.map((child) => this.toSymbol(document, child));
		return result;
	}

	private range(document: vscode.TextDocument, range: Range): vscode.Range {
		return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
	}

	private rangeFor(file: string, range: Range): vscode.Range {
		const lineStarts = this.index.workspaceIndex.file(file)?.lineStarts;
		const start = positionAt(lineStarts, range.start);
		const end = positionAt(lineStarts, range.end);
		return new vscode.Range(start.line, start.character, end.line, end.character);
	}

	private uriWithLine(file: string, offset: number): vscode.Uri {
		const lineStarts = this.index.workspaceIndex.file(file)?.lineStarts;
		const position = positionAt(lineStarts, offset);
		return vscode.Uri.parse(file).with({ fragment: `L${position.line + 1}` });
	}

	private indexable(document: vscode.TextDocument): boolean {
		return indexSettings().enabled && isIndexableUri(document.uri);
	}

	private cached(document: vscode.TextDocument): CachedDocument {
		const key = document.uri.toString();
		const existing = this.cache.get(key);
		if (isFresh(existing, document)) {
			// Keep recently used documents at the end of the LRU order.
			this.cache.delete(key);
			this.cache.set(key, existing);
			return existing;
		}
		const next = this.scan(document, key);
		this.store(key, next);
		return next;
	}

	private scan(document: vscode.TextDocument, key: string): CachedDocument {
		const text = document.getText();
		const settings = indexSettings();
		if (text.length > settings.maxBytes) {
			return { version: document.version, oversized: true };
		}
		return this.scanContent(document, key, text);
	}

	private scanContent(document: vscode.TextDocument, key: string, text: string): CachedDocument {
		const ecuc = isEcucValues(text, document.uri.fsPath);
		return ecuc
			? { version: document.version, model: scanEcucValues(text) }
			: { version: document.version, file: buildFileIndex(key, text) };
	}

	private store(key: string, next: CachedDocument): void {
		this.cache.delete(key);
		this.cache.set(key, next);
		while (this.cache.size > 8) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.cache.delete(oldest);
		}
	}

	/** Drops a closed document from the scan cache. */
	forget(uri: string): void {
		this.cache.delete(uri);
	}

	private fileIndex(document: vscode.TextDocument): FileIndex {
		return buildFileIndex(document.uri.toString(), document.getText());
	}
}

/** A definition whose own range contains `offset` (definition files). */
function definitionAt(file: FileIndex, offset: number): IndexDefinition | undefined {
	let best: IndexDefinition | undefined;
	for (const definition of file.definitions) {
		if (isNarrowerDefinition(definition, best, offset)) {
			best = definition;
		}
	}
	return best;
}

function isNarrowerDefinition(
	definition: IndexDefinition,
	best: IndexDefinition | undefined,
	offset: number
): boolean {
	if (!containsOffset(definition, offset)) {
		return false;
	}
	return best === undefined || definition.range.end - definition.range.start < best.range.end - best.range.start;
}

function containsOffset(definition: IndexDefinition, offset: number): boolean {
	return definition.range.start <= offset && offset <= definition.range.end;
}

/** Appends `Label: value` only when the value is present. */
function appendOptionalLine(lines: string[], label: string, value: string | undefined): void {
	if (value !== undefined) {
		lines.push(`${label}: ${value}`);
	}
}

/** Appends a bare optional line only when the text is present. */
function appendOptionalText(lines: string[], value: string | undefined): void {
	if (value !== undefined) {
		lines.push(value);
	}
}

/** True when the cached scan still matches the document's version. */
function isFresh(existing: CachedDocument | undefined, document: vscode.TextDocument): existing is CachedDocument {
	return existing !== undefined && existing.version === document.version;
}

function symbolKind(kind: SymbolData['kind']): vscode.SymbolKind {
	switch (kind) {
		case 'module':
			return vscode.SymbolKind.Module;
		case 'container':
			return vscode.SymbolKind.Namespace;
		case 'reference':
			return vscode.SymbolKind.Object;
		default:
			return vscode.SymbolKind.Field;
	}
}

function symbolKindFor(definitionKind: string): vscode.SymbolKind {
	if (definitionKind.endsWith('-MODULE-DEF')) {
		return vscode.SymbolKind.Module;
	}
	if (definitionKind.endsWith('-CONTAINER-DEF')) {
		return vscode.SymbolKind.Namespace;
	}
	if (definitionKind.endsWith('-REFERENCE-DEF')) {
		return vscode.SymbolKind.Object;
	}
	return vscode.SymbolKind.Field;
}

/** Registers the text-editor providers; every subscription is owned by `context`. */
export function registerTextFeatures(context: vscode.ExtensionContext, index: IndexService): void {
	const features = new TextFeatures(index);
	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument((document) => features.forget(document.uri.toString())),
		vscode.languages.registerDocumentSymbolProvider(SELECTOR, features),
		vscode.languages.registerDefinitionProvider(SELECTOR, features),
		vscode.languages.registerReferenceProvider(SELECTOR, features),
		vscode.languages.registerDocumentLinkProvider(SELECTOR, features),
		vscode.languages.registerHoverProvider(SELECTOR, features)
	);
}
