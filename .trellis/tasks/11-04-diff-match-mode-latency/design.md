# Design — cached match-mode switching

## Boundaries

| Layer | File | Change |
|---|---|---|
| Pure diff | `src/core/diff/diffSession.ts` (new) | Prepared-side holder, per-mode document cache, semantic-equivalence reuse |
| Core tests | `src/test/core/diffSession.test.ts` (new) | Cache hits, equivalence, invalidation, strict/semantic difference |
| Host | `src/host/diffPanel.ts` | Prepared sides keyed by document version; `applyMatchMode`; version guard; ack; error revert |
| Protocol | `src/diffProtocol.ts` | Host→page `matchModeState` |
| Webview | `src/webview/diffViewer.ts` | Optimistic mode flip, pending state, ack handling |
| Toolbar | `src/webview/components/toolbar/toolbar.ts` / `.css` | `setMatchMode(semantic, pending)` and busy styling |
| Benchmark | `src/test/benchmarks/diffToggleBenchmark.ts` (new) | First build vs cached switch budget |

## 1. Pure session

```ts
export interface DiffPreparedSide {
	rows: readonly EcucRow[];
	rangeOf: RangeLookup;
	header: DiffHeader;
}

export interface DiffSessionResult {
	document: DiffDocument;
	/** False when the same document object is already displayed. */
	changed: boolean;
}

export class DiffSession {
	constructor(
		left: FileLabel,
		right: FileLabel,
		leftSide: DiffPreparedSide,
		rightSide: DiffPreparedSide
	);
	document(semantic: boolean): DiffSessionResult;
	invalidate(): void;
}
```

`document(semantic)`:

1. Return the cached document for that mode when present (`changed` is whether it differs from the
   last returned object).
2. Build with `buildDiffDocument(..., { semanticMatching: semantic })`.
3. If `semantic === true` and `summary.renamed === 0`, strict and semantic output are identical:
   cache the built document under both keys and reuse the last displayed document when one exists.
4. Otherwise cache only the requested mode.
5. Set the last returned document.

`invalidate()` clears both the document cache and the last pointer. The host creates a new session
per successful refresh instead of reusing one, so invalidation also happens implicitly.

## 2. Host

`DiffPanel.open` keeps:

```ts
interface PreparedSide {
	document: vscode.TextDocument;
	version: number;
	rows: EcucRow[];
	rangeOf: RangeLookup;
	header: DiffHeader;
}
```

- `prepareSide(document)` wraps the existing `rowsFor`.
- `session = new DiffSession(leftLabel, rightLabel, preparedLeft, preparedRight)`.
- `current = session.document(semantic).document`.

`refreshNow` (edits, initial load, stale fallback) rebuilds both prepared sides, creates a new
session, posts the document and keeps the current mode.

`matchMode` no longer calls `refreshNow` unless a prepared side is stale:

```ts
const stale = preparedLeft.document.version !== preparedLeft.version ||
	preparedRight.document.version !== preparedRight.version;
```

- Stale → set `semantic`, run `refreshNow()`, which posts a document.
- Fresh → set `semantic`, call `session.document(next)`.
  - `changed` → update `current`, post the document with the mode.
  - unchanged → update `current`, post `{ type: 'matchModeState', semantic }`.
- Build failure → restore the previous mode, post `matchModeState` with the restored mode and the
  existing error notice.

The host keeps the last decoded text? No: `rowsFor` already owns the model and the rows. Only the
`TextDocument` reference is retained for its live `version`.

## 3. Protocol and page

Add host→page:

```ts
| { type: 'matchModeState'; semantic: boolean }
```

The page:

- On toolbar click: set `semanticMatching`, call `toolbar.setMatchMode(next, true)`, post
  `matchMode`. The toolbar flips immediately, sets `aria-busy`, shows a spinner and writes
  `Switching to Semantic/Strict…` into a live status slot.
- On `document`: adopt `message.semantic`, set the document, call `updateViewButtons()` (clears
  pending and restores the summary), render.
- On `matchModeState`: adopt `message.semantic`, call `updateViewButtons()` so the status clears and
  the summary is restored.
- `setMatchMode(semantic, pending)` sets `aria-pressed`, `aria-busy`, the label and the live status.
  CSS dims the button, spins a small ring while `aria-busy="true"`, and uses `cursor: progress`.

No page-side document cache: the webview keeps one document to bound memory. A large renamed diff
pays one post per actual document change, not a re-scan.

## 4. Compatibility and tradeoffs

- `buildDiffDocument` and both document shapes are unchanged.
- `matchModeState` is additive; an older page ignores it.
- The session may retain one extra `DiffDocument` when both modes differ (renames exist). It drops it
  on every refresh and panel dispose.
- The semantic-equivalence rule is deliberately narrow: only a *semantic* build with
  `renamed === 0` proves the two modes are identical. A strict build always says `renamed === 0` and
  cannot be used to skip the semantic build.

## 5. Rollback

Delete `diffSession.ts` and its tests, restore `matchMode` to `void refreshNow()`, remove
`matchModeState` and the pending toolbar state. No data or manifest migration is involved.
