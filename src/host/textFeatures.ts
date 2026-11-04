/**
 * Text-editor providers for ARXML: symbols, definition, references, links and
 * hover. They reuse the same scanner and workspace index as the custom editor;
 * the plain editor sees unsaved text because the document is the source here.
 */
import * as vscode from 'vscode';
import { isEcucValues } from '../core/ecuc/detect';
import { buildNodeIndex } from '../core/ecuc/nodeId';
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
}

const SELECTOR: vscode.DocumentSelector = [{ pattern: '**/*.arxml' }];

export class TextFeatures
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
		if (data.model !== undefined) {
			return documentSymbols(data.model).map((symbol) => this.toSymbol(document, symbol));
		}
		const file = data.file ?? this.fileIndex(document);
		return file.definitions.map((definition) => {
			const range = this.range(document, definition.range);
			return new vscode.DocumentSymbol(
				definition.shortName,
				definition.path,
				symbolKindFor(definition.kind),
				range,
				range
			);
		});
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
			const definition = this.index.workspaceIndex.definitionEntry(token.rawPath);
			return definition === undefined
				? undefined
				: new vscode.Location(vscode.Uri.parse(definition.file), this.rangeFor(definition.file, definition.range));
		}
		const resolution = this.index.resolveTarget(token.rawPath, token.dest, document.uri.toString());
		if (!resolution.ok || resolution.copies.length === 0) {
			return undefined;
		}
		const locations = resolution.copies.map(
			(copy) => new vscode.Location(vscode.Uri.parse(copy.file), this.rangeFor(copy.file, copy.range))
		);
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
			const token = refTokenAt(data.model, offset);
			if (token?.kind === 'definition') {
				return this.index
					.definitionUsers(token.rawPath)
					.map((user) => new vscode.Location(vscode.Uri.parse(user.file), this.rangeFor(user.file, user.range)));
			}
			if (token?.kind === 'target') {
				const resolution = this.index.resolveTarget(token.rawPath, token.dest, document.uri.toString());
				if (!resolution.ok) {
					return [];
				}
				return resolution.copies.flatMap((copy) =>
					this.index
						.referencesFor(copy)
						.map((reference) => new vscode.Location(vscode.Uri.parse(reference.file), this.rangeFor(reference.file, reference.range)))
				);
			}
			const nodeIndex = buildNodeIndex(data.model);
			const entryId = innermostNodeIdAt(nodeIndex, offset);
			const entry = entryId === undefined ? undefined : nodeIndex.byId.get(entryId);
			if (entry?.path !== undefined) {
				const target: IndexElement = {
					kind: entry.kind === 'module' ? 'module' : 'container',
					path: entry.path,
					file: document.uri.toString(),
					range: entry.range,
				};
				return this.index
					.referencesFor(target)
					.map((reference) => new vscode.Location(vscode.Uri.parse(reference.file), this.rangeFor(reference.file, reference.range)));
			}
		}
		const definition = data.file === undefined ? undefined : definitionAt(data.file, offset);
		if (definition !== undefined) {
			return this.index
				.definitionUsers(definition.path)
				.map((user) => new vscode.Location(vscode.Uri.parse(user.file), this.rangeFor(user.file, user.range)));
		}
		return [];
	}

	provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
		if (!this.indexable(document)) {
			return [];
		}
		const data = this.cached(document);
		if (data.model === undefined) {
			return [];
		}
		const links: vscode.DocumentLink[] = [];
		for (const token of refTokens(data.model)) {
			const target = this.targetFor(token, document.uri.toString());
			if (target === undefined) {
				continue;
			}
			const link = new vscode.DocumentLink(this.range(document, token.range));
			link.target = this.uriWithLine(target.file, target.range.start);
			link.tooltip = token.rawPath;
			links.push(link);
		}
		return links;
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
			const definition = this.index.workspaceIndex.definitionEntry(token.rawPath);
			if (definition === undefined) {
				return undefined;
			}
			const info = definitionInfo(definition);
			const lines = [`**${info.type}** \`${definition.path}\``];
			if (info.range !== undefined) {
				lines.push(`Range: ${info.range}`);
			}
			if (info.multiplicity !== undefined) {
				lines.push(`Multiplicity: ${info.multiplicity}`);
			}
			if (info.description !== undefined) {
				lines.push(info.description);
			}
			lines.push(`_${info.fileName}_`);
			return lines.join('\n\n');
		}
		const resolution = this.index.resolveTarget(token.rawPath, token.dest, sourceFile);
		if (!resolution.ok) {
			return undefined;
		}
		const element = resolution.element;
		const definition = element.definitionRef === undefined ? undefined : this.index.definition(element.definitionRef);
		const lines = [`**Target** \`${element.path ?? token.rawPath}\``, `Kind: ${element.kind}`];
		if (resolution.copies.length > 1) {
			lines.push(`Copies: ${resolution.copies.map((copy) => copy.file.split('/').pop()).join(', ')}`);
		}
		if (definition !== undefined) {
			lines.push(`Type: ${definition.type}`);
			if (definition.range !== undefined) {
				lines.push(`Range: ${definition.range}`);
			}
			if (definition.multiplicity !== undefined) {
				lines.push(`Multiplicity: ${definition.multiplicity}`);
			}
			if (definition.description !== undefined) {
				lines.push(definition.description);
			}
		}
		return lines.join('\n\n');
	}

	private targetFor(token: RefToken, sourceFile: string): { file: string; range: Range } | undefined {
		if (token.kind === 'definition') {
			if (this.index.workspaceIndex.definitionCandidateCount(token.rawPath) > 1) {
				return undefined;
			}
			const definition = this.index.workspaceIndex.definitionEntry(token.rawPath);
			return definition === undefined ? undefined : { file: definition.file, range: definition.range };
		}
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
		if (existing !== undefined && existing.version === document.version) {
			// Keep recently used documents at the end of the LRU order.
			this.cache.delete(key);
			this.cache.set(key, existing);
			return existing;
		}
		const text = document.getText();
		const settings = indexSettings();
		let next: CachedDocument;
		if (text.length > settings.maxBytes) {
			next = { version: document.version, oversized: true };
		} else {
			const ecuc = isEcucValues(text, document.uri.fsPath);
			next = {
				version: document.version,
				...(ecuc ? { model: scanEcucValues(text) } : { file: buildFileIndex(key, text) }),
			};
		}
		this.cache.delete(key);
		this.cache.set(key, next);
		while (this.cache.size > 8) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.cache.delete(oldest);
		}
		return next;
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
		if (definition.range.start <= offset && offset <= definition.range.end) {
			if (best === undefined || definition.range.end - definition.range.start < best.range.end - best.range.start) {
				best = definition;
			}
		}
	}
	return best;
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
