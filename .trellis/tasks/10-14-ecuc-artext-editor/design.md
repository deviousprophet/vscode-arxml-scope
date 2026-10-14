# Design: ECUC ARTEXT editor for ARXML files

Companion to `prd.md` in this directory. Requirement analysis and the full description of the legacy
pipeline being replaced live in `research/legacy-artext-analysis.md`. This document records the
technical design, the decision register behind `prd.md`'s requirements, and the tradeoffs.

## 1. Context

`ecucvalues-for-vscode` v1.3.1 renders ECUC-Values arxml readable by a two-stage detour: it spawns
`mmx.exe` (third-party, Windows-only, `license.dat`, ~13 MB of DLLs) to write an intermediate
`.artext` text file into `.artext_cache/` beside the user's source, then **parses that text back** to
locate arxml positions for navigation, using a second, independent regex/offset index of the same
file (262 lines) whose results are cached in `customData.definitionIndex`.

This design parses the `.arxml` **once**, in-process, into a model whose nodes each carry their own
source range. Rendering, navigation and editing then read ranges the model already holds. Every
piece of the reference's machinery that exists only to serve the detour is deleted rather than
ported — see §12.

## 2. Decision register

Traced to the questions settled during requirement exploration.

| # | Decision | Rationale |
|---|---|---|
| D1 | ARTEXT is a **view**; the source of truth is the arxml element. Edits target the owning element, never generated text. | The legacy mapping is provably lossy — `!string [] !replace null` and `!pi [] !replace null` drop unmapped text and processing instructions, comments are never emitted, `AUTOSAR !replace` keeps only the first AR-PACKAGE hierarchy "to drop the EcucValueCollections package", and `sort all` reorders. Editing the text and writing it back cannot reconstruct the file. |
| D2 | The view is a **`CustomTextEditorProvider`**, not a webview panel and not a virtual document. | The `.arxml` stays the file, so save/dirty and diff work natively; every rendered node naturally maps to a source range; avoids reimplementing an editor surface from scratch. |
| D3 | **Only `<VALUE>` text is editable**, for numerical and textual parameters. | One surgical replacement, no index or definition lookup. Reference retargeting needs completion infrastructure and structural edits need `ECUC-MODULE-DEF` constraints — both deferred. |
| D4 | **The ARTEXT text form, its TextMate grammar, `Open as ARTEXT` and Compare are dropped.** | They exist only to make the projection readable in a plain text editor. With a custom editor rendering the model, a derived text file is a second artefact kept in sync and the sole reason for the reference's cache, hashing, lock file and pruning. Compare was a diff of two generated texts, so it went with them; element-level comparison is F9's job. |
| D5 | The editor claims **ECUC-Values files only**; other `.arxml` opens normally. The scanner is nonetheless written reusable. | Visible scope stays honest and small, while avoiding a throwaway parsing layer when F3/F4 land. |
| D6 | Parity target is **semantic/informational**, not byte-exact. | No committed `.artext` exists in any repository history, the format has no specification, there is no golden data, and the only automated consumer compares line *sets* and already tolerates drift. |
| D7 | A **single-file, hand-rolled streaming scanner**, with a seam for F0. No workspace index, no worker thread, no new runtime dependency. | The editor shows one file, which is exactly what it can parse. F0's workspace index is a separate deliverable; the scanner's output type is the seam. |
| D8 | Labels are the **`DEFINITION-REF` tail**; the full path is available on hover. No definition resolution. | The legacy mapping shows only the tail. Real `ECUC-MODULE-DEF` definitions live in a separate `EcucModuleDefs` package (observed), so same-file resolution would usually find nothing; doing it properly is F2 + F0. |
| D9 | **Bidirectional reveal** plus **same-file** reference following. | Reveal is nearly free once nodes carry ranges. Same-file following is a path→range lookup the model already supports. This deliberately *fixes* the reference, whose `getWordRangeAtPosition(position, /[\w.]+/)` yields `Target.Path` and misses the bare-`SHORT-NAME` lookup. |
| D10 | Save/dirty, undo/redo and pre-write validation are **mandatory**; a **filter box** replaces text find. | Non-optional lifecycle behaviour for a custom editor; text find is the wrong affordance for a structured tree. |
| D11 | `sort all` with the 15-entry exception list are **ported verbatim and exposed as settings**, defaults matching the reference. | The ordering is semantic, not cosmetic: entries whose `DEFINITION-REF` tail is listed keep declaration order among themselves. |
| D12 | This feature is documented in **`docs/ECUC_EDITOR.md`**; `docs/FEATURES_PLAN.md` is untouched. | Keeps the committed read-only roadmap intact while the shipped feature is documented where it belongs. |
| D13 | **Synthetic fixtures committed** plus a **gitignored local directory** for real files. | The remote is public and the only real ECUC sample available is live customer configuration; the reference's `.gitignore` contains `src/test/data/`, showing the same judgement. |
| D14 | The editor activates **only on explicit request**. | Never silently replaces the editor users already rely on, and per D3 it deliberately does not render everything in the file. |
| D15 | **No derived artefacts** are written to the workspace. | Nothing to cache once no external process needs an output path. |
| D16 | Core code **must not import `vscode`**, so it can run under F0 and later a standalone LSP. | Restates `docs/FEATURES_PLAN.md` §4 for this feature. |

## 3. Module boundaries and file layout

Existing build layout (unchanged by this design): `rootDir: src`, `esbuild.js` bundles the entry to
`dist/extension.js` (the `main`), `npm run compile-tests` runs `tsc -p . --outDir out`, and
`npm test` runs `vscode-test` over `out/test/**/*.test.js` as declared in `.vscode-test.mjs`.

```
src/
  core/                      # NO vscode imports (D16)
    ecuc/
      model.ts               # node types, Range, SortMode
      detect.ts              # isEcucValues(text, filePath)
      scanner.ts             # scanEcucValues(text) -> EcucDocumentModel
      order.ts               # SORT_EXCEPTIONS, ordering functions
      resolve.ts             # dotted-path -> Range lookup
      validate.ts            # value validation + XML escaping
    text/
      offsets.ts             # LineIndex: char offset -> Position
  editor/
    ecucEditorProvider.ts    # CustomTextEditorProvider
    ecucDocument.ts          # CustomDocument: edits, invertible events, save/revert
    renderHtml.ts            # webview HTML/CSS/JS, inlined
  commands.ts                # open + reveal commands
  extension.ts               # activation wiring
  test/
    core/*.test.ts           # scanner, order, resolve, validate
    editor/*.test.ts         # provider, reveal, write-back
    fixtures/*.arxml         # synthetic, committed
    expected/*.json          # expected models, committed
    data/                    # gitignored, local real files (D13)
```

Webview assets are **inlined as template strings** in `renderHtml.ts` rather than shipped as files,
so `esbuild.js` needs no asset-copy step and `.vscodeignore` needs no new entry. An inline script
requires a `nonce` and a `Content-Security-Policy` meta tag in the generated HTML.

Tests run inside the extension host via `@vscode/test-electron`, so "pure Node" core tests still
execute there; they are kept free of `vscode` imports (D16) so they remain runnable under plain Node
later.

## 4. Core contracts

```ts
// core/ecuc/model.ts
export interface Range { start: number; end: number }   // UTF-16 offsets into the source text

export interface Suffixes {
  syscond?: string;                                     // SW-SYSCOND text, trimmed
  syscondRange?: Range;
  postBuildVariants?: { criterion: string; operator: string; value: string }[];
  postBuildRange?: Range;
  annotations?: { label?: string; text?: string; range?: Range }[];
}

export interface ModuleNode extends Suffixes {
  kind: 'module';
  definitionRef: string; definitionRefRange?: Range;
  shortName: string;      shortNameRange?: Range;
  variant?: string;       variantRange?: Range;
  range: Range;                                         // whole ECUC-MODULE-CONFIGURATION-VALUES
  containers: ContainerNode[];
}

export interface ContainerNode extends Suffixes {
  kind: 'container';
  definitionRef: string; definitionRefRange?: Range;
  shortName: string;      shortNameRange?: Range;
  range: Range;
  containerPath: string[];                              // ancestor SHORT-NAME chain, module last
  parameters: ParameterNode[];
  references: ReferenceNode[];
  containers: ContainerNode[];
}

export interface ParameterNode extends Suffixes {
  kind: 'parameter';
  numeric: boolean;
  definitionRef: string; definitionRefRange?: Range;
  name: string;                                         // DEFINITION-REF tail
  displayValue?: string;                                // entity-decoded text for display
  hexValue?: string;                                    // numeric and not true/false only
  valueRange?: Range;                                   // text content inside <VALUE>
  range: Range;
}

export interface ReferenceNode extends Suffixes {
  kind: 'reference';
  instance: boolean;
  definitionRef: string; definitionRefRange?: Range;
  name: string;
  targetRawPath?: string;                               // verbatim VALUE-REF / TARGET-REF text
  targetPath?: string;                                  // dotted equivalent of \structify
  contextPaths: string[];
  targetRange?: Range;                                  // text content inside VALUE-REF / TARGET-REF
  range: Range;
}

export interface EcucDocumentModel {
  schema?: { release: string };
  packages: { path: string[]; range: Range }[];         // ancestor AR-PACKAGE chain per module
  modules: ModuleNode[];
  pathIndex: Map<string, Range>;                        // SHORT-NAME path -> element range, same file
}
```

```ts
export function isEcucValues(text: string, filePath: string): boolean;   // detect.ts
export function scanEcucValues(text: string): EcucDocumentModel;         // scanner.ts
export const SORT_EXCEPTIONS: readonly string[];                         // order.ts
export type SortMode = 'all' | 'declaration';
export function orderModules(m: ModuleNode[], mode: SortMode, except: readonly string[]): ModuleNode[];
export function orderContainers(c: ContainerNode[], mode: SortMode, except: readonly string[]): ContainerNode[];
export function orderMembers(p: ParameterNode[], r: ReferenceNode[], mode: SortMode, except: readonly string[]): { parameters: ParameterNode[]; references: ReferenceNode[] };
export function resolvePath(index: Map<string, Range>, dottedPath: string): Range | undefined;   // resolve.ts
export function validateValue(p: ParameterNode, input: string): { ok: true; text: string } | { ok: false; reason: string };  // validate.ts
export class LineIndex { positionAt(offset: number): { line: number; character: number } }       // text/offsets.ts
```

Ordering functions are pure and return new arrays; the caller decides when to apply them, so the
setting can be toggled without re-parsing.

## 5. Scanner specification

**Input and memory.** The provider receives a `TextDocument` for the file being viewed, so the
source text comes from `document.getText()` and all writes go through a `WorkspaceEdit` on that same
document. This keeps offsets, line endings, encoding and BOM handling entirely inside VS Code — the
scanner never touches the filesystem and never has to reproduce VS Code's encoding behaviour. The
scanner makes a single pass **without building a DOM**, and the model retains no copy of the input
string. *Assumption:* an ECUC-Values file is single-digit megabytes; whole-workspace scale is F0's
problem, and a size guard is a candidate for `implement.md` rather than a requirement here.

**Lexing rules** (single pass, iterative stack — never recursive, so nesting depth cannot blow the
stack):

| Construct | Handling |
|---|---|
| `<?…?>` processing instruction | skipped |
| `<!-- … -->` comment | skipped |
| `<![CDATA[…]]>` | text captured verbatim; not entity-decoded |
| `<!DOCTYPE …>` | skipped (including internal subset brackets) |
| start / end / self-closing tags | parsed with attribute values in single or double quotes, which may themselves contain `>` |
| namespace prefix | stripped before comparing a tag name (`ns:VALUE` ≡ `VALUE`) |
| entity references in text | decoded into `displayValue` values only; all recorded `Range`s point at the **raw** text so a write preserves the original encoding |

**Captured elements** are exactly those the legacy mapping reads: `AUTOSAR` (for
`xsi:schemaLocation`), `AR-PACKAGE`, `ELEMENTS`, `ECUC-MODULE-CONFIGURATION-VALUES`, `ANNOTATIONS`,
`ANNOTATION`, `LABEL`, `ANNOTATION-TEXT`, `VERBATIM`, `VARIATION-POINT`, `SW-SYSCOND`,
`POST-BUILD-VARIANT-CONDITIONS`, `POST-BUILD-VARIANT-CONDITION`, `MATCHING-CRITERION-REF`, `VALUE`,
`DEFINITION-REF`, `SHORT-NAME`, `IMPLEMENTATION-CONFIG-VARIANT`, `CONTAINERS`, `PARAMETER-VALUES`,
`REFERENCE-VALUES`, `SUB-CONTAINERS`, `ECUC-CONTAINER-VALUE`, `ECUC-NUMERICAL-PARAM-VALUE`,
`ECUC-TEXTUAL-PARAM-VALUE`, `ECUC-REFERENCE-VALUE`, `ECUC-INSTANCE-REFERENCE-VALUE`, `VALUE-REF`,
`VALUE-IREF`, `TARGET-REF`, `CONTEXT-ELEMENT-REF`.

**`<VALUE>` is context-dependent.** It appears both as the value of an `ECUC-*-PARAM-VALUE` and as
the compared value inside a `POST-BUILD-VARIANT-CONDITION`. The scanner resolves it from the open
element stack, never from the tag name alone. This is the single most likely source of a subtle model
bug and must be covered by a fixture containing both.

**Scope of collection.** Modules are collected wherever they appear (the legacy mapping uses
`descendant`), each with its ancestor `AR-PACKAGE` chain. The legacy `AUTOSAR !replace` keeps only the
first AR-PACKAGE hierarchy "to drop the EcucValueCollections package"; the editor instead renders every
collected module, which is strictly more information and cannot hide configuration from the user.

**`pathIndex`.** Built during the same pass: for every element carrying a `SHORT-NAME`, record the
`/`-joined ancestor chain → element range. This is what makes same-file reference following (R6) a
lookup rather than a second parse. Unlike the reference's index, it is not persisted anywhere.

## 6. Model semantics, ordering and display

**Ordering (D11).** The legacy sort key is the string
`DEFINITION-REF + '"' + (SHORT-NAME | VALUE | VALUE-REF | VALUE-IREF) + '"'`, or `DEFINITION-REF`
alone when the `DEFINITION-REF` tail is in the exception list. Implemented here as a **tuple
comparison** `(definitionRef, identity)` with an empty identity for exception entries. The two are
equivalent for ordering because `"` (U+0022) sorts below every character permitted in an AUTOSAR
short-name or path (`[A-Za-z0-9_.\-/]`), so the separator never changes the outcome of a comparison.
This is a deliberate implementation choice, not a behavioural deviation, and must be covered by a
test that exercises a `DEFINITION-REF` that is a prefix of another.

The exception entries must keep **declaration order** among themselves, which requires a **stable**
sort. `Array.prototype.sort` is required to be stable (ES2019+), so it is used directly. Whether the
MM `sort` is itself stable is not established by `research/legacy-artext-analysis.md`; observed
behaviour is consistent with stability, and the requirement makes stability the only sensible choice.

Sorting is applied per list and **never interleaves** parameters with references, because the legacy
emission order is always `PARAMETER-VALUES` then `REFERENCE-VALUES`: modules, then per module its
containers, then per container its parameters, its references, and its child containers.

**Display rules.** These are what the editor shows; they preserve the *information* the legacy text
carried (D6) without the text itself.

| Entity | Primary label | Secondary | Suffixes |
|---|---|---|---|
| schema | detected release (`00048`) | — | — |
| package | `A.B.C` | — | — |
| module | full `DEFINITION-REF` dotted path | `"SHORT-NAME"` | `(VariantPreCompile)` when present, then conditions, then annotations |
| container | `DEFINITION-REF` tail | `"SHORT-NAME"` | conditions then annotations |
| parameter | `DEFINITION-REF` tail | `= value`; for numeric values that are not `true`/`false`, the hexadecimal form as secondary | conditions then annotations |
| reference | `DEFINITION-REF` tail | `= targetPath`; for an instance reference, additionally `context A, B` | conditions then annotations |
| condition | — | `[SW-SYSCOND]` and `<Ref == value && …>` | — |
| annotation | `[Label]` | annotation text | — |

Hovering a container or parameter exposes the full `DEFINITION-REF` path (D8 / R8). `hexValue` is
recomputed after every edit. The schema release uses the legacy derivation: last whitespace token of
`xsi:schemaLocation` → split on `"."` take index 1 → split on `"_"` take the last → `-` replaced by `.`.

## 7. Same-file reference resolution

`pathIndex` is keyed by the leading-slash `SHORT-NAME` chain, e.g. `/PkgA/PkgB/Container/Sub`.

Resolution order: **exact match on the raw path**, then longest-suffix match. A suffix match that is
ambiguous resolves to nothing rather than guessing.

**Deliberate deviation:** resolution reads `targetRawPath` (the verbatim `/A/B/C` text), never the
dotted `targetPath` display form. Converting the dotted form back to slashes is ambiguous if any
short-name contains a dot, and the reference's own reliance on a rendered token is exactly what broke
its navigation (D9). This is the fix, not a port.

## 8. Write-back and validation

**Write path.** The webview posts `{ type: 'edit', nodeId, value }`; the provider validates, applies
`WorkspaceEdit.replace(uri, range, escaped)` to the `TextDocument`, and fires an invertible edit event
(§9). The `<VALUE>`/`</VALUE>` tags, surrounding whitespace, indentation and every other byte of the
file stay untouched (R11, AC7).

Two write shapes, because an ECUC value can be written in two ways:

1. **Text content present** — replace `node.valueRange`, the text content inside `<VALUE>`.
2. **Element empty or self-closing** (`<VALUE/>`, `<VALUE></VALUE>`) — replace the entire element
   range with `<VALUE>encoded</VALUE>`. This is the only structural change the design permits, and it
   is confined to the element being edited.

**Escaping on write:** `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`. A value containing a character that
XML 1.0 cannot represent even when escaped (control characters other than tab, newline, carriage
return) is rejected rather than mangled.

**Validation (R13), in core so it is unit-testable without `vscode`:**

- Numerical parameters accept `true` / `false`, a decimal integer `-?\d+`, hexadecimal
  `0[xX][0-9A-Fa-f]+`, and a decimal fraction with optional exponent. Everything else is refused.
- Textual parameters accept any string that is representable in XML 1.0.
- An edit that does not change the value is refused, so idling never dirties the document.

Rejection returns a reason which the editor surfaces; **no file mutation occurs** (R13, AC9).

## 9. Editor: provider, document lifecycle, undo/redo, webview

**Contribution.** A `contributes.customEditors` entry with `viewType`
`vscode-arxml-scope.ecucEditor` and `selector: [{ filenamePattern: '*.arxml' }]`. Because D14 forbids
taking over by default, activation is driven by the command
`vscode-arxml-scope.openEcucEditor`, which verifies detection and then calls
`vscode.commands.executeCommand('vscode.openWith', uri, 'vscode-arxml-scope.ecucEditor')`. The same
editor is reachable through VS Code's own *Open With…*, which is the explicit path.

**`resolveCustomTextEditor(document, panel, token)`:**

1. Reject a document that is not `.arxml` or fails detection: show a message and reopen with the
   default editor rather than rendering an empty shell.
2. `scanEcucValues(document.getText())` once, and build a `LineIndex`.
3. Render inlined HTML (CSS + JS + `nonce` + CSP meta) from the model.
4. `webview.onDidReceiveMessage` handles `ready`, `edit`, `reveal` and `filter`.
5. Subscribe to `workspace.onDidChangeTextDocument` for this document and re-scan, so undo/redo and
   external edits both refresh the view.
6. Dispose the listener and handle `panel.onDidDispose`.

**Undo/redo, dirty state and save come from VS Code, not from us.** `CustomTextEditorProvider`
declares only `resolveCustomTextEditor(document: TextDocument, …)`: it has no `openCustomDocument`, no
`onDidChangeCustomDocument` and no save/revert hooks — those belong to `CustomEditorProvider`, the
variant that owns a custom document of its own. Because every write goes through `WorkspaceEdit` on
the **real `TextDocument`**, the text document's own history and dirty tracking apply: Ctrl+Z and
Ctrl+Y work with one press per edit, the dirty dot appears, and save is a plain save. There is
therefore **no invertible `CustomDocumentEditEvent` to build, no `undo()`/`redo()` callbacks, and no
private history**. An earlier draft of this design specified exactly that machinery; it was removed
after the API was read, and the corrected statement is recorded in
`research/spike-results.md` §Spike A. What still deserves a manual check is only the behaviour: one
press per undo, a dirty dot after an edit, and a save that persists (§14).

**Filter.** Client-side over the rendered tree, matching label, short-name and value. No round-trip to
the extension host.

**Theming and keyboard.** CSS custom properties (`--vscode-*`) only, no hard-coded colours; tree roles
with `tabindex`, arrow-key traversal, Enter to commit an edit, Escape to cancel.

## 10. Navigation mechanics, and its main risk

- **Editor → source:** `vscode.openWith(uri, 'default', …)` at the node's range, then reveal. The file
  must be shown in the *text* editor to show raw XML, so this swaps the editor rather than adding a
  second pane.
- **Source → editor:** a command offered from the arxml text editor that maps the cursor offset to the
  innermost node via a binary search over node ranges, then opens the custom editor with that node
  selected.

**Risk, to validate before building much on it.** VS Code normally shows a given resource in one
editor at a time, so a *live* side-by-side pairing of the custom editor and the plain text editor for
the same file may not be achievable without the user opening one of them in a second group with
*Open With*. The two command-driven reveals above satisfy R9 either way; if live synchronisation is
expected, it must be spiked first. Tracked in §15.

## 11. Contributions

| Contribution | Value | Note |
|---|---|---|
| `commands` | `vscode-arxml-scope.openEcucEditor` | Opens the file in the custom editor after detection passes |
| `commands` | `vscode-arxml-scope.revealInSource` | Editor → arxml range (§10) |
| `commands` | `vscode-arxml-scope.revealInEcucEditor` | arxml cursor → editor node (§10) |
| `customEditors` | `viewType: vscode-arxml-scope.ecucEditor`, `selector: [{ filenamePattern: '*.arxml' }]` | Never selected by default (D14) |
| `menus` | `explorer/context` and `editor/context`, enabled for `.arxml` | Entry points for the explicit commands |
| `configuration` | `arxmlScope.ecuc.editor.sort` — `"all"` (default) \| `"declaration"` | D11 |
| `configuration` | `arxmlScope.ecuc.editor.sortExcept` — string array, default the 15 entries from `Arxml2Artext.cmd` | D11 |

Command ids keep the `vscode-arxml-scope.` prefix that the repository scaffold already established.
Setting keys use `arxmlScope.` to match the extension's display name. The two prefixes differing is
inherited from the scaffold, not introduced here.

Removing the placeholder `vscode-arxml-scope.helloWorld` command is optional cleanup and not part of
any acceptance criterion.

## 12. Reference machinery deleted rather than ported

| Reference component | Why it disappears |
|---|---|
| `bin/**` (~13 MB), `mmx.exe`, `license.dat`, `Arxml2Artext.cmd`, the `win32`-only gate | The transform is reimplemented in TypeScript (D1, D7) |
| `.artext_cache/`, `cache.json`, `.lock`, sha256 hashing, pruning (~160 lines) | Every one of these exists because an external process needs an output path to write to. No subprocess, no output file, nothing to cache (D15) |
| The ARTEXT text form, `syntaxes/artext.tmLanguage.json`, `language-configuration.json` | No text surface is shipped (D4) |
| `arxmlIndexer.ts` (262 lines) and `customData.definitionIndex` | A second parse of a file already parsed, whose only purpose is offset lookup. The model carries ranges natively (D7) |
| The `[regex]` post-process whitespace patch | It existed only to tidy `mmx`'s inline whitespace inside `[...]` (D4) |
| `artextDefinitionProvider.ts` (203 lines) | Replaced by range-based reveal and `pathIndex` resolution (D9) |

## 13. Compatibility, rollout and rollback

**Compatibility.** The change is purely additive: one new `viewType`, three commands, two settings, and
new core modules. Nothing existing changes behaviour, and because D14 forbids taking over the default
editor, a user who never invokes the command sees no difference at all.

**Coexistence with `ecucvalues-for-vscode`.** Both extensions may be installed simultaneously. They
share no code, no state and no files: different command ids, different `viewType`s, and this design
never reads or writes `.artext_cache`. Both may appear in *Open With…* for `.arxml`, which is
acceptable and is the user's choice to make.

**Rollback.** Revert the feature commits. No cleanup step is needed, because D15 guarantees no derived
artefacts and the only mutations this feature performs are the user's own explicit value edits to their
own files. Settings and the `viewType` simply cease to exist.

**Versioning.** The feature ships under the repository's current version; the minor bump and
`CHANGELOG.md` entry belong to Phase 3.

## 14. Test strategy and fixtures

**Core tests** (`src/test/core/`, no `vscode` imports, D16):

- Scanner: synthetic fixtures → model compared against committed `src/test/expected/*.json`.
- Ordering: `sort all` vs `declaration`; exception entries keeping declaration order; a
  `DEFINITION-REF` that is a prefix of another; parameters and references never interleaving.
- Resolution: exact hit, unique suffix hit, ambiguous suffix resolving to nothing, absent path.
- Validation: accepted literal forms, refused forms, unchanged-value refusal, XML-illegal characters.

**Editor integration tests** (`src/test/editor/`, under `vscode-test`), one per cross-child acceptance
criterion that needs a live editor: detection and activation gate (AC2, AC4), reveal both directions
(AC5), same-file reference following and cross-file no-throw (AC6), write-back byte comparison (AC7),
undo/redo and dirty state (AC8), refused value leaving the file untouched (AC9), and no files created
near the fixture during a full flow (AC10).

**Fixtures** are synthetic and cover, at minimum: namespace-prefixed tags; a container nested six
levels deep; CDATA text; entity references; comments and processing instructions; a self-closing
`<VALUE/>`; a `<VALUE>` appearing both as a parameter value and inside a
`POST-BUILD-VARIANT-CONDITION` (the §5 ambiguity); a reference that resolves in-file; a reference to an
absent path; and short-names drawn representatively from the exception list.

**Provenance rule.** Expected models are authored from the rules recorded in
`research/legacy-artext-analysis.md`, never generated by the scanner under test — otherwise the test
only asserts that the code agrees with itself.

**Gitignore.** The repository's current `.gitignore` covers `out`, `dist`, `node_modules`,
`.vscode-test/` and `*.vsix` only. `src/test/data/` must be added for D13's local real-file directory.

**Validation commands.** `npm run check-types`, `npm run lint`, `npm test`.

## 15. Open questions and risks

1. **Live vs command-driven reveal (§10).** Whether a custom editor and the plain text editor can show
   the same resource simultaneously is unverified. Spike this before building anything on top of it;
   R9 is satisfiable with commands alone either way.
2. **Undo/redo wiring (§9).** *Settled from the API, not by risk:* `CustomTextEditorProvider` exposes
   no edit-event hook, so undo/redo/dirty/save are the real `TextDocument`'s own and there is no
   contract to get wrong. Only the behaviour needs the manual check in Spike A (one press per undo,
   dirty dot, save persists). Do not reintroduce the invertible-event machinery.
3. **Scanner edge cases (§5).** `<!DOCTYPE>` internal subsets, CDATA, entity decoding and attribute
   values containing `>` are the likely defect sites. Fixtures exist for them; the scanner's behaviour
   on these must be asserted rather than assumed.
4. **Large files.** No size guard is specified. Add one only if a real file proves slow — a guard that
   refuses legitimate files would be worse than the cost it avoids.
5. **Large trees.** Virtualisation is not planned. Measure the webview with a realistically large ECUC
   tree before optimising it.
6. **Legacy `sort` stability** is not established (D6 rules out byte-level parity, so this is
   informational only).
7. **Re-opening Compare.** If element-level comparison is wanted soon, it needs F9's AR-path matching;
   the cheap text diff was given up with D4 and should not be quietly reintroduced.

