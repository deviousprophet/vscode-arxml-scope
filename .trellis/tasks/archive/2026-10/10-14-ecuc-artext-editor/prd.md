# ECUC ARTEXT editor for ARXML files

## Goal

Let a user open an AUTOSAR **ECUC-Values** `.arxml` file in a purpose-built, **editable** custom
editor that renders the file's configuration directly, and navigate between that editor and the
source XML.

The reference implementation (`ecucvalues-for-vscode` v1.3.1) reaches a readable view only by
spawning the third-party Windows-only `mmx` binary to write an intermediate `.artext` text file,
then **parsing that text back** to the arxml to support navigation — through a second, independent
regex index of the same file. Both stages are the limitation this task removes: it parses the
`.arxml` **once**, in-process, into a model whose nodes each carry their own source range, so
rendering, navigation and editing are all direct.

**ARTEXT** is retained as the name of the *information model and semantics* — what
`src/Arxml2Artext/Arxml2Artext.mm` expresses — not as a text artefact. See "Explicitly dropped".

Requirements are recorded as decisions D1..D16 in `design.md` §2, each traced to the analysis in
`research/legacy-artext-analysis.md`.

## Scope

**In scope**

- A single-file, streaming scanner for ECUC-Values arxml that yields an ARTEXT information model in
  which every node carries its own source range.
- Model content equivalent to what the legacy mapping conveys: schema release, package path, module
  (`DEFINITION-REF` path, `SHORT-NAME`, implementation config variant), containers, numerical and
  textual parameters, references and instance references, plus the `SW-SYSCOND`,
  post-build-variant and annotation suffixes.
- The legacy ordering semantics (`sort all` with its exception list), as a setting.
- A same-file path index so a reference value can resolve to its target element.
- A `CustomTextEditorProvider` rendering the model for ECUC-Values files, activated **only** on
  explicit request.
- Bidirectional reveal between the editor and the source arxml, plus same-file reference following.
- In-place editing of parameter `<VALUE>` text with undo/redo and pre-write validation.
- A filter box in the editor.

**Explicitly dropped**

- **The ARTEXT text form, its TextMate grammar and the `Open as ARTEXT` command.** They existed to
  make the projection readable in a plain text editor. With a custom editor rendering the model,
  a derived text file is a second artefact to keep in sync and the only thing that forced the
  reference's `.artext_cache`, hashing, lock file and cache pruning. Dropping it is the main
  simplification in this plan.
- **Compare (select-left / compare-with-left / compare-selected).** It was implemented as a diff of
  two generated text forms, so it depended on the artefact just dropped. Element-level comparison
  belongs to `docs/FEATURES_PLAN.md` F9 (AR-path matching) and is out of scope here.

**Out of scope (other owners)**

- Software components, ports, interfaces, connectors, and any non-ECUC AUTOSAR object. ARTEXT cannot
  express them: `docs/FEATURES_PLAN.md` F3/F4/F8.
- Cross-file definition resolution (F2), package merging and the workspace index (F0). The scanner is
  built reusable so F0 can slot in, but the index is not built here.
- Structural editing (adding/removing containers or parameters) and `SHORT-NAME` renaming (F10).
- Reference retargeting (`<VALUE-REF>` editing).
- Semantic validation (F5), the element search panel (F6), the ARXML-aware diff (F9) and the
  formatter (F11).
- Byte-exact parity with `mmx` output, and any dependency on the legacy binaries.

## Requirements

R1. The scanner reads a single `.arxml` file, streaming, without building a full DOM, and must not
import the `vscode` API, so it can later run under F0 / a standalone LSP.

R2. ECUC-Values detection must accept namespace-prefixed tags, matching the reference's
`/<(?:\w+:)?ECUC-MODULE-CONFIGURATION-VALUES(\s|>)/i`, and must reject non-`.arxml` inputs before
reading content.

R3. Every model node must carry the character range of the source element it came from, and of the
specific text it renders where applicable (a parameter's value, an element's short name, a
reference's target path).

R4. The model must carry the information the legacy mapping conveys, including the condition and
annotation suffixes, and must correctly handle containers nested at least 5 levels deep.

R5. Ordering must follow `sort all`: modules, containers, parameters and references sorted by
`DEFINITION-REF` then identity, except entries whose `DEFINITION-REF` tail is in the exception list,
which keep declaration order among themselves. It is controlled by a setting whose default
reproduces `sort all except <the 15-entry list>`.

R6. A reference value must resolve to its target element's range when the target is in the same file.

R7. The custom editor activates only via an explicit command or *Open With*, never as the default
editor for `.arxml`.

R8. The editor renders the model as a hierarchical view: module → container → parameters and
references, with values, condition suffixes and annotations visible.

R9. Selecting an entity in the editor reveals the corresponding range in the source `.arxml`;
placing the cursor in the source reveals the corresponding entity in the editor.

R10. Clicking a reference value navigates to its target when the target resolves in the same file;
an unresolvable or cross-file target degrades without error.

R11. Parameter `<VALUE>` text is editable. A write changes only the owning element's text; the rest
of the file is byte-identical.

R12. Edits are undoable and redoable, and the document participates in the normal save/dirty
lifecycle.

R13. Values are validated before any write; invalid input is refused with a message and no file
mutation occurs.

R14. A filter box narrows the rendered tree.

R15. No derived artefacts are written to the user's workspace.

R16. Presentation must use VS Code theme variables and be keyboard-navigable.

R17. No real customer ECUC file may be committed. Test fixtures are synthetic; real-file testing uses
a gitignored local directory only.

R18. The legacy extension `ecucvalues-for-vscode` is left untouched and `docs/FEATURES_PLAN.md` is
left as-is; this feature is documented in `docs/ECUC_EDITOR.md`.

## Constraints

- No dependency on `mmx`, `license.dat`, or any Windows-only binary; the extension must not gate on
  `process.platform`.
- Node and VS Code APIs plus the existing devDependencies only — no new runtime dependency for XML
  parsing.
- The repository remote is **public**. Committed fixtures must be synthetic.

## Task map

| Task | Deliverable | Verifiable by |
|---|---|---|
| `10-14-ecuc-model-scanner` (P1) | Core: streaming scanner, ARTEXT model with ranges, same-file path index, ordering semantics | Model assertions against committed expected fixtures, incl. deep nesting; pure Node tests |
| `10-14-artext-custom-editor` (P1) | The editor: `CustomTextEditorProvider`, rendering, activation gate, bidirectional reveal, same-file reference following, filter | Editor opens on request only; reveal maps both ways; filter narrows |
| `10-14-ecuc-value-editing` (P2) | `<VALUE>` write-back, undo/redo, validation | Diff shows only the owning `<VALUE>` changed; invalid input refused |

Ordering: `ecuc-model-scanner` is a prerequisite for both others; `ecuc-value-editing` depends on
`artext-custom-editor`. Parent/child is not a dependency system — each child restates its
prerequisites in its own `prd.md`.

## Acceptance criteria (cross-child)

- [ ] AC1. The model extracted from a synthetic ECUC-Values fixture matches the committed expected
      model, including containers nested 5+ levels deep and all condition/annotation suffixes.
- [ ] AC2. A non-ECUC `.arxml` is rejected by the editor surface, and a non-`.arxml` file is rejected
      before any content read.
- [ ] AC3. Ordering matches `sort all` with the exception list; entries in the list keep declaration
      order. Toggling the setting changes the result.
- [ ] AC4. A `.arxml` opened normally does **not** use the custom editor.
- [ ] AC5. Reveal works in both directions for a module, a nested container, a parameter and a
      reference.
- [ ] AC6. Same-file reference following lands on the target element; a cross-file target does not
      throw.
- [ ] AC7. Editing a parameter value produces a diff whose only changed bytes are inside the owning
      `<VALUE>`, verified by comparing the file before and after.
- [ ] AC8. Undo/redo restores and reapplies the change; the dirty indicator appears and clears on save.
- [ ] AC9. An invalid value is refused, an error is shown, and the file is unchanged on disk.
- [ ] AC10. Running the full flow leaves no new files anywhere near the user's arxml.
- [ ] AC11. No committed file contains real customer data; the local real-file directory is ignored.
- [ ] AC12. The full repository test suite and lint pass.

## Risks

- **Streaming without a dependency.** Hand-rolled XML handling must cope with CDATA, entities,
  comments, namespace prefixes and attribute order. `design.md` §5 pins the required behaviour.
- **Depth.** The reference's own CHANGELOG records a critical indexing bug at 5+ nesting levels, so
  fixtures must cover deep nesting and AC1's expected model must be authored from the `.mm` rules,
  not generated by the code under test.
- **Semantic ambiguity.** Where the `.mm` uses constructs with no exact JavaScript equivalent, the
  chosen behaviour must be recorded in `design.md` and covered by a test.
- **Write-back safety.** A wrong range would corrupt the user's file; AC7 exists to make that
  observable.
- **Editor lifecycle.** `CustomTextEditorProvider` requires the extension to supply invertible edit
  events and to implement save/revert; getting this wrong produces an editor that never saves.
  Coordinating that wiring with real write-back is a scheduling risk.
- **Dropping Compare may be revisited.** If element-level comparison is wanted soon, it needs F9's
  matching work rather than the cheap text diff that was given up here.
