# Design: streaming workspace index

## Boundaries

```
src/core/index/xmlStream.ts      chunk-fed XML tokenizer (pure)
src/core/index/indexModel.ts     FileIndex, IndexElement, IndexReference, IndexDefinition
src/core/index/indexBuilder.ts   tokenizer events -> FileIndex (pure)
src/core/index/workspaceIndex.ts many FileIndex values, lookup + stats + change callback (pure)
src/core/text/xmlText.ts         entity decode shared with the existing scanner (pure)
src/host/indexService.ts         discovery, fs read stream, watcher, status bar, command
src/extension.ts                 constructs the service, exposes a small API for tests
src/commands.ts                  registers the rebuild command
```

`core` owns everything that can be decided from bytes. `host` owns filesystem, workspace and UI.

## Tokenizer

`class XmlStreamParser` with callbacks:

```ts
interface XmlStreamHandlers {
  open(name: string, attrs: ReadonlyMap<string, string>, offset: number): void;
  close(name: string, offset: number): void;
  text(text: string, start: number, end: number): void;
}
```

`write(chunk: string)` appends to a tail buffer and consumes every complete construct; `end()` flushes
the remaining complete text and ignores an unterminated construct. Absolute offsets are
`consumedOffset + indexInBuffer`. A construct that is not complete is kept from its `<` and retried on
the next chunk; text before a kept `<` is emitted immediately. This makes chunk boundaries
unobservable.

Markup handling mirrors `scanner.ts`: quote-aware tag end, `<!-- -->`, `<![CDATA[ ]]>`, `<? ?>`,
`<!DOCTYPE>` with bracket depth and quoted strings.

## Index model

```ts
interface IndexElement {
  kind: 'module' | 'container' | 'parameter' | 'reference';
  path?: string;          // AR path for modules/containers
  definitionRef?: string; // instance definition target
  definitionDest?: string;
  shortName?: string;
  uuid?: string;
  file: string;           // URI string
  range: Range;
}

interface IndexReference {
  sourcePath?: string;    // container/module AR path when available
  definitionRef: string;
  targetRawPath?: string;
  targetDest?: string;    // VALUE-REF/TARGET-REF DEST
  contextPaths: string[];
  file: string;
  range: Range;
}

interface IndexDefinition {
  path: string;           // definition's own AR path
  kind: string;           // element tag, e.g. ECUC-INTEGER-PARAM-DEF
  shortName: string;
  description?: string;
  defaultValue?: string;
  range?: string;         // display range from lower/upper limits or min/max
  lowerMultiplicity?: number;
  upperMultiplicity?: number; // -1 = unbounded
  destinationRef?: string;
  literals?: string[];
  file: string;
  rangeOffsets: Range;
}

interface FileIndex {
  uri: string;
  schemaRelease?: string;
  packages: string[];
  elements: IndexElement[];
  references: IndexReference[];
  definitions: IndexDefinition[];
}
```

Ranges are UTF-16 offsets into that file, converted through `LineIndex` only at the VS Code boundary.

## Builder

One element stack. `AR-PACKAGE` short names form the package chain. Module values, container values
and definition elements push their AR path; parameters and references inherit the nearest container
path. Text capture is limited to a small set of tags (`SHORT-NAME`, `DEFINITION-REF`, `UUID`,
`VALUE-REF`, `TARGET-REF`, `CONTEXT-ELEMENT-REF`, limits, default, `DESTINATION-REF`, `L-2`). The
builder accumulates text for the current element only, not the document.

Definition paths use the same package + short-name chain, so an `ECUC-MODULE-DEF` at
`/Pack/Mod` and its parameter at `/Pack/Mod/Cont/P` are addressable exactly as instance
`DEFINITION-REF` values are.

## Workspace lookup

- Exact AR path first. A single path-suffix match wins; two or more matches are ambiguous and return
  `undefined` (never guess).
- Definition lookup uses the same rule over definition paths.
- Stats are computed from the map in O(files) and are cheap enough for a status bar refresh; entries
  themselves are not copied.

## Host service

- `start()`: create the status bar, watcher and initial build.
- Discovery: `workspace.findFiles('**/*.arxml')` (so `files.exclude` is honoured), ordered by URI for
  deterministic status.
- Read: `fs.createReadStream(path)` + `TextDecoder('utf-8')` streaming; chunk size 64 KiB; feed the
  builder. A read error skips the file and records a skipped count, never a partial index.
- File size guard uses `fs.promises.stat` before opening.
- Watcher events are coalesced per URI with a 250 ms timer. Create/change reindexes one file; delete
  removes one file. A configuration change re-runs discovery.
- Status bar updates after every batch and after each incremental change. A `$(database)` icon
  prefixes the text; the label itself stays plain text so tests and screen readers read the count.
- The service publishes a `vscode.Event`-free change callback; the editor provider subscribes and
  re-pushes rows. (Host layer may use `vscode.EventEmitter`; the core does not.)

## Ordering and lifecycle

`activate` creates `IndexService`, calls `start()` without awaiting (indexing must not delay
activation), and registers the rebuild command. All disposables go to `context.subscriptions`. The
service stops its watcher and timer on dispose.

## Rollback

Delete the new `core/index` and `host/indexService` modules, the status-bar command and manifest
settings; the existing single-file editor is untouched because rows only gain an optional enrichment
field.
