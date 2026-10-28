# Legacy ARTEXT pipeline: reference analysis

Analysis of `D:\workspace\00_Tools\ecucvalues-for-vscode` (v1.3.1), performed to define the
ARTEXT semantics reimplemented by this task. All statements are either **observed** (quoted
from source or a real generated artifact) or marked **inferred**.

Reference repository is **not** indexed by CodeGraph and is a separate git repository
(36 commits). It is a Bosch-hosted extension; its fixtures are deliberately uncommitted.

---

## 1. Source inventory

| Path | Size | What it is |
|---|---|---|
| `src/Arxml2Artext/Arxml2Artext.mm` | 8,326 B / 196 lines | **The entire conversion logic.** Readable text. Authoritative spec of the transform. |
| `src/Arxml2Artext/Arxml2Artext.cmd` | 437 B / 2 lines | Launcher: prepends `bin` to `PATH`, invokes `mmx`. Holds the sort exception list. |
| `src/Arxml2Artext/bin/**` | ~13 MB | Ovidius "MM" 4.2.1 build130 runtime: `mmx.exe`, `MM*.dll`, `plugins/MM*.dll`, `com.ovidius.mm.jar`, `license.dat`, `MFC71.dll`, `xerces-c_3_1.dll`. |
| `src/arxmlIndexer.ts` | 262 lines | Regex + char-offset index of the **source arxml**, built as a second pass. |
| `src/artextGenerator.ts` | 171 lines | Detection, `mmx` invocation, cache read/write, post-process. |
| `src/artextCache.ts` | 160 lines | `cache.json` + `.lock`, sha256, pruning, `customData` side-channel. |
| `src/artextDefinitionProvider.ts` | 203 lines | Go-to-definition from generated artext back to the arxml. |
| `src/extension.ts` | 217 lines | 4 commands, save-triggered regeneration, Windows gate. |
| `syntaxes/artext.tmLanguage.json` | 62 lines | `source.artext` grammar. |
| `language-configuration.json` | — | Folding via `^\s*{\s*$` / `^\s*}\s*$`. |

`bin/.cvsinfo.mm` identifies the toolchain: `mmx`, CVS tag `mm_4_2_1_build130`, dated 2003.

The executable is invoked as:

```
mmx -M Arxml2Artext.mm -S <in.arxml> -T <out.artext> -A sort all except <15-entry list>
```

---

## 2. The transform, exactly as written

### 2.1 Helper definitions

| Helper | Definition (`.mm`) | Effect |
|---|---|---|
| `\indent()` | `"\n", "    ".duplicate(count(self.ancestor))` | newline + 4 spaces per ancestor level |
| `\structify()` | `join((this.split("/")):2~-1, ".")` | `/A/B/C` → `A.B.C`. Skips only the empty leading segment. |
| `\lastShortName()` | `this.split("/"):-1` | last `/` segment |
| `\camelize()` | split on `-`, uppercase first char of each word, lowercase the rest, join | `VARIANT-PRE-COMPILE` → `VariantPreCompile` |
| `\appendSyscond()` | if `SW-SYSCOND`: `" [" + trim(data) + "]"` | |
| `\appendPBVarCond()` | if `POST-BUILD-VARIANT-CONDITION`: `" <"` + for each, `MATCHING-CRITERION-REF.lastShortName + " == " + VALUE.trim`, joined by `" && "`, + `">"` | |
| `\formatAnnotation()` | if `LABEL`: `" [" + LABEL/L-4.trim + "] "`, then `ANNOTATION-TEXT/VERBATIM/L-5.trim` | label then text |
| `\appendAnnotations()` | if `ANNOTATIONS`: `" /*"` + `ANNOTATION.formatAnnotation` + `" */"` | |
| `\appendGstStuff()` | `syscond` + `pbvar` + `annotations` | appended to module/container/param/ref lines |

### 2.2 Emitted lines

| arxml element | Emitted text |
|---|---|
| `SCHEMA` | `schema <n>` + `\n`, where `<n>` = `schemaLocation` → last whitespace token → split `"."` take `:1` → split `"_"` take `:-1` → `-` replaced by `.` |
| `AR-PACKAGE` | `package <STRUCTIFY of package path>` + `\n` |
| `ECUC-MODULE-CONFIGURATION-VALUES` | `\indent` + `module <DEFINITION-REF.structify> "<SHORT-NAME>"` + ` (<camelized IMPLEMENTATION-CONFIG-VARIANT>)` if present + `\appendGstStuff` + `\indent` + `{` |
| — module close (`!up`) | `\indent` + `}` + `\n` |
| `ECUC-CONTAINER-VALUE` | `\indent` + `<DEFINITION-REF.lastShortName> "<SHORT-NAME>"` + `\appendGstStuff` + `\indent` + `{` |
| — container close (`!up`) | `\indent` + `}` (no `\n`) |
| `ECUC-NUMERICAL-PARAM-VALUE` | `\indent` + `<def.lastShortName> = <VALUE>` + ` (= 0x<dec2hex(VALUE)>)` **unless** VALUE is `true` or `false` + `\appendGstStuff` |
| `ECUC-TEXTUAL-PARAM-VALUE` | `\indent` + `<def.lastShortName> = "<VALUE>"` + `\appendGstStuff` |
| `ECUC-REFERENCE-VALUE` | `\indent` + `<def.lastShortName> = <VALUE-REF.structify>` + `\appendGstStuff` |
| `ECUC-INSTANCE-REFERENCE-VALUE` | `\indent` + `<def.lastShortName> = <VALUE-IREF/TARGET-REF.structify>` + ` context <join(CONTEXT-ELEMENT-REF.structify, ", ")>` if present + `\appendGstStuff` |
| every other string | `!string [] !replace null` — **dropped** |
| every processing instruction | `!pi [] !replace null` — **dropped** |

**Layout detail (parity-critical).** `\indent` emits a newline *before* its text, so the opening
brace lands on its **own line**, indented to the element's depth:

```
module RB.RBA.rba_Nds.EcucModuleDefs.rba_Nds "rba_Nds"
{
    rba_Nds_Communication "rba_Nds_Communication"
    {
```

This matches `language-configuration.json`'s folding markers and the second branch of
`artextDefinitionProvider`'s `declLine` lookup.

### 2.3 Ordering and replacement (`!TRANSFORMATION`)

- `AUTOSAR` → replaced by: the `SCHEMA` node (`xsi:schemaLocation`), then
  `self.r.descendant[?ELEMENTS]:1` — **only the first AR-PACKAGE hierarchy**, with the comment
  *"Only take first AR-PACKAGE hierarchy to drop the EcucValueCollections package"* — then the
  module list (sorted under `sort all`).
- `ELEMENTS` → replaced by `AR-PACKAGE` nodes whose text is the `/`-joined ancestor
  `AR-PACKAGE/SHORT-NAME` chain.
- `ECUC-MODULE-CONFIGURATION-VALUES` → child order: `ANNOTATIONS`, `VARIATION-POINT`,
  `DEFINITION-REF`, `SHORT-NAME`, `IMPLEMENTATION-CONFIG-VARIANT`, then `CONTAINERS/ECUC-CONTAINER-VALUE`.
- `ECUC-CONTAINER-VALUE` → child order: `ANNOTATIONS`, `VARIATION-POINT`, `DEFINITION-REF`,
  `SHORT-NAME`, then `PARAMETER-VALUES` (numerical | textual), `REFERENCE-VALUES`
  (reference | instance-reference), `SUB-CONTAINERS/ECUC-CONTAINER-VALUE`.
- `VARIATION-POINT` → `SW-SYSCOND` + `POST-BUILD-VARIANT-CONDITIONS/POST-BUILD-VARIANT-CONDITION`.
- `SYSC-REF` → `data.lastShortName`.
- Under `sort all`, the module list, the three container lists and the three parameter lists are
  each wrapped in `sort(..., \sortKey())`.

### 2.4 Sort key and exception semantics

```
\sortKey() = join(
  if (child[?DEFINITION-REF].data.\lastShortName() === *argExcept)
    then (child[?DEFINITION-REF].data)                       // DefinitionRef only
    else (child[?DEFINITION-REF].data, "\"",                 // DefinitionRef +
          child[?SHORT-NAME | ?VALUE | ?VALUE-REF | ?VALUE-IREF].data, "\"")  // + identity
)
```

The exception list is **not** in the `.mm`; it is hardcoded in `Arxml2Artext.cmd`:

```
DcmDspDidRef, DcmDspRequestRoutineResultsOutSignal, DcmDspStartRoutineInSignal,
DcmDspStartRoutineOutSignal, DcmDspStopRoutineInSignal, DcmDspStopRoutineOutSignal,
DcmArgumentRef, DemDidDataElementClassRef, DemExtendedDataRecordClassRef,
DemDataElementClassRef, DemDidClassRef, DemFreezeFrameRecordClassRef,
DemSPNClassRef, EcuMDriverInitItem, EcuMRbCallOutItem
```

`.mm` documents a trap: `except A,B` is legal, `except A, B` (with a space) is a **runtime error**.

---

## 3. Observed real output

The only `.artext` artifact on this machine (untracked, generated):

`D:\workspace\00_Tools\rba_nds_gen\ref_input\MLBevo\ComSCL_NetMtrx_RbaNds\_gen\_2026_09_10_13_17_07\.artext_cache\comscl_netmtrx_calidcvn_ecucvalues.artext`
(75,147 B), beside `cache.json` (1,629,797 B). `rba_nds_gen` is not a git repository.

Head of that file (verbatim):

```
schema 00048
package RB.UBK.Project.EcucModuleConfigurationValuess

module RB.RBA.rba_Nds.EcucModuleDefs.rba_Nds "rba_Nds"
{
    rba_Nds_Communication "rba_Nds_Communication"
    {
        ...
        IniValue = 63 (= 0x3F)
        ...
        ComVeh_CalIdCvn "ComVeh_CalIdCvn_EPS" [(HESRV_HETYP_SY==HESRV_ONEBOX)]
```

This **confirms and corrects** two points:

1. `schema 00048` — real files yield the numeric AUTOSAR release id, not a dotted version. The
   `.mm` header comment's example (`4.0.2`) is hypothetical.
2. `\structify` does **not** truncate: `module … EcucModuleDefs.rba_Nds` retains the final
   segment, and reference values print the **full** dotted target path.
3. The post-process (below) is what turns a padded syscond into `[(HESRV_HETYP_SY==HESRV_ONEBOX)]`
   — inner whitespace removed, so the grammar's `(...)` variant rule and the condition rule both
   have to tolerate a squeezed form.

---

## 4. Reference extension architecture and call chain

**Produce**

1. Commands in `extension.ts`: `openArtext`, `selectLeft`, `compareWithLeft`, `compareSelected`;
   plus `workspace.onDidSaveTextDocument` for silent regeneration.
2. `artextGenerator.generateArtext(uri, token)`:
   - gate `isEcucValuesArxml()` — `/<(?:\w+:)?ECUC-MODULE-CONFIGURATION-VALUES(\s|>)/i` on `.arxml`
   - cache dir `<arxml dir>/.artext_cache`, output `<basename>.artext`
   - in-memory fast path on `mtimeMs`, then sha256 content hash
   - regenerate via `execFile('cmd.exe', ['/c', scriptPath, arxmlPath, artextPath], { cwd: scriptDir, windowsHide: true })`,
     where `scriptDir = path.join(__dirname, 'Arxml2Artext')`, copied by
     `package.json` `compile`: `xcopy src\Arxml2Artext out\Arxml2Artext /s /y /i`
   - `postProcessArtextGen`: `content.replace(/\[([\s\S]*?)\]/g, (_, i) => '[' + i.replace(/\s+/g, '') + ']')`
   - `buildAndCacheDefinitionIndex()` → `ArxmlIndexer.buildDefinitionIndex(arxmlContent)`,
     stored as `cache.customData['definitionIndex']`
3. `extension.ts` also guards `process.platform !== 'win32'` → warning message and early return.

**Consume**

4. `openTextDocument(artextPath)` / `showTextDocument`, or `vscode.diff` for Compare.
   Language id `artext` → grammar + language configuration.
5. `ArtextDefinitionProvider.provideDefinition` (registered `{ language: 'artext' }`):
   - `document.getWordRangeAtPosition(position, /[\w.]+/)` — **dots included**
   - map `.artext_cache/X.artext` → sibling `X.arxml` via `getSourceArxml`
   - if line contains `=`: scan backwards for `{`/`}` to build the enclosing container stack,
     then `definitionIndex.containers[containerName][symbol]`, filtered by `containerPath` suffix,
     then disambiguated by comparing the value after `=`
   - else `definitionIndex.shortNames[symbol]` → `Location`

**Defect (observed).** For a generated line `Name = Target.Path`, the word range with `/[\w.]+/`
yields the literal `Target.Path`, which is looked up in `shortNames` (keyed by bare SHORT-NAME).
The lookup misses. Reference-following is therefore effectively broken in the tool being ported.

**`ArxmlIndexer` shape**

```ts
interface DefinitionIndex {
  shortNames: Record<string, { start: number; end: number }>;
  containers: Record<string, Record<string, Array<{
    start: number; end: number; value?: string; containerPath?: string[];
  }>>>;
}
```

- Built by depth-counting `<ECUC-CONTAINER-VALUE>`…`</ECUC-CONTAINER-VALUE>` spans by hand.
- Splits each container's "header" (everything before `<SUB-CONTAINERS>`) from its sub-containers,
  so only direct `PARAMETER-VALUES` / `REFERENCE-VALUES` are indexed at that level.
- Registers each parameter/reference under **every ancestor container name** — documented by its
  own test as "indexes parameters under ancestor containers to support nested lookup".
- Parameter name = last `/` segment of `DEFINITION-REF`. Reference value = last `/` segment of `VALUE-REF`.
- Known fragility, from the repo's own `CHANGELOG.md`: `1.2.1` *"Fixed: Critical indexing bug for
  parameters in deeply nested containers (5+ levels)"*; `1.1.0` *"Enhanced regex patterns for ECUC
  parameter and reference value matching"*.

---

## 5. Consumers of the ARTEXT text (parity evidence)

| Consumer | Location | Coupling |
|---|---|---|
| TextMate grammar | `syntaxes/artext.tmLanguage.json` | Surface tokens: `{`/`}`, `"`-strings, `=`, `(Variant)`, `Name "…"`, hex, condition operators. Whitespace-tolerant (`\s*`, `\b`). |
| Definition provider | `artextDefinitionProvider.ts` | `text.endsWith('{')`, `^\w+\s+"([^"]+)"`, `lineText.includes('=')`. Uses `.trim()` and `\s*`. |
| **External equivalence gate** | `rba_nds_gen\CVOPL-8198_template_migration_plan.md` (untracked) | Invokes `Arxml2Artext.cmd` **directly** (not via the extension), then `Compare-Object` on **line sets**, ignoring the random `rba_Nds_ConsistencyCheckNumber` line. Its post-process regex is byte-identical to the extension's. Documents that two fresh runs differ by 2 lines and a packaged baseline by 776 lines — drift is already tolerated. |
| No others | — | Recursive search across all repos under `D:\workspace\00_Tools` found no parser, no golden file, no snapshot test, no script reading `.artext`. `vscode-arxml-scope` contains no occurrence of `artext` at all. |

### Parity verdict

- **No committed `.artext` anywhere, ever.** `git log --all --diff-filter=A` for `*.artext`/`*.arxml`
  in the reference repo is empty across all 36 commits; `src/test/data/` is in its `.gitignore`.
- **No format specification.** `README.md` describes it only as *"Open `.arxml` files that contain
  ECUC Values configuration as `.artext` for easy reading"*. `CHANGELOG.md` records only
  highlighting/parsing fixes, never a format change.
- **No test coverage of the format.** `git log --all --name-only -- 'src/test/data*'` is empty:
  the fixtures the two integration tests reference **never existed in git and are absent from disk**,
  so those tests cannot run. `src/test/extension.test.ts` is an empty `suite('Test bootstrap', …)`.
- `Compare-Object` compares **sets**, so reordering is not flagged; within-line content changes are.
  The only gate that consumes the text is order-independent and already drifts.

Conclusion: **semantic parity is sufficient**; byte-identity is not required by any consumer, and
there is no golden data to verify against anyway.

---

## 6. Consequential simplifications for the reimplementation

| Reference machinery | Why it can be deleted here |
|---|---|
| `bin/**`, `mmx`, `license.dat`, `Arxml2Artext.cmd`, `.mm` | The transform is being reimplemented in TypeScript. Removes ~13 MB of Windows binaries, the licence file and the `win32`-only gate. |
| `.artext_cache/`, `cache.json`, `.lock`, sha256, pruning | These exist **only** because an external process needs a file path to write to. With no subprocess there is nothing to cache. Also removes the workspace pollution that the reference never gitignores. |
| `arxmlIndexer.ts` + `customData.definitionIndex` | A second, separate pass whose only purpose is "which arxml range is this token". A custom editor parses in order to render, so it already holds those ranges. |
| `postProcessArtextGen` regex patch | Both the extension and the external gate carry it solely to remove `mmx`'s inline whitespace inside `[...]`. |

---

## 7. Facts not established

- Whether any real `.artext` file is cached in a customer workspace outside `D:\workspace\00_Tools`
  is unobservable from here.
- `arxmlGenerator.ts` / `postConvert`, referenced by the external gate's migration plan, is not
  present in any repository under `D:\workspace\00_Tools`; whether it consumes ARTEXT beyond the
  documented regex is unknown.
- Whether users informally diff freshly generated `.artext` against legacy output is not
  determinable from source.
- One recursive search inside `rba_nds_gen` timed out on a second pass; a >2 MB script there could
  reference ARTEXT without being seen. Low confidence gap.
