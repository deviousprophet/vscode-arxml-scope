/**
 * Cached document building for one prepared diff pair.
 *
 * The panel's expensive work is scanning and row building, not toggling the
 * matching mode. The host prepares both sides once per document version and
 * hands them here; this class builds each mode lazily and reuses the last
 * document when the semantic pass found no rename. In that case the strict and
 * semantic outputs are identical, so the page does not need another payload.
 *
 * Pure: no `vscode` import and no DOM.
 */
import { DiffDocument, DiffHeader, FileLabel, RangeLookup, buildDiffDocument } from '../../core/diff/diffModel';
import type { EcucRow } from '../../core/ecuc/renderRows';

/** The row build for one side of a comparison. */
export interface DiffPreparedSide {
	rows: readonly EcucRow[];
	rangeOf: RangeLookup;
	header: DiffHeader;
}

export interface DiffSessionResult {
	document: DiffDocument;
	/** True when this document differs from the one returned previously. */
	changed: boolean;
}

export class DiffSession {
	private readonly documents = new Map<boolean, DiffDocument>();
	private last: DiffDocument | undefined;

	constructor(
		private readonly left: FileLabel,
		private readonly right: FileLabel,
		private readonly leftSide: DiffPreparedSide,
		private readonly rightSide: DiffPreparedSide
	) {}

	/** Builds or reuses the document for one matching mode. */
	document(semantic: boolean): DiffSessionResult {
		const cached = this.documents.get(semantic);
		if (cached !== undefined) {
			return this.remember(cached);
		}
		return this.build(semantic);
	}

	/** Drops every cached document; the next request rebuilds from the sides. */
	invalidate(): void {
		this.documents.clear();
		this.last = undefined;
	}

	private build(semantic: boolean): DiffSessionResult {
		const built = buildDiffDocument(
			this.left,
			this.right,
			this.leftSide.rows,
			this.rightSide.rows,
			this.leftSide.rangeOf,
			this.rightSide.rangeOf,
			{ left: this.leftSide.header, right: this.rightSide.header },
			{ semanticMatching: semantic }
		);
		if (semantic && built.summary.renamed === 0) {
			return this.share(built);
		}
		this.documents.set(semantic, built);
		return this.remember(built);
	}

	/**
	 * No semantic pair was added, so strict and semantic output are the same.
	 * Reuse the displayed document when it is also a no-rename document;
	 * otherwise the freshly built one becomes the shared document.
	 */
	private share(built: DiffDocument): DiffSessionResult {
		const shared = this.reusableTwin(built);
		this.documents.set(true, shared);
		this.documents.set(false, shared);
		return this.remember(shared);
	}

	private reusableTwin(built: DiffDocument): DiffDocument {
		return this.last !== undefined && this.last.summary.renamed === 0 ? this.last : built;
	}

	private remember(document: DiffDocument): DiffSessionResult {
		const changed = document !== this.last;
		this.last = document;
		return { document, changed };
	}
}
