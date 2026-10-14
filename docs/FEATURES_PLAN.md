# ARXML VS Code Extension: Feature Plan

**Vision:** an AUTOSAR-aware language server and architecture explorer for VS Code. Plain XML editing is already well covered. The value is in understanding AUTOSAR objects, references and relationships across many large files.

## Project Decisions

| Topic | Decision |
|-------|----------|
| AUTOSAR platforms | Classic **and** Adaptive |
| Schemas | **Bundle** the XSDs with the extension |
| First audience | **BSW / ECUC engineers** (ECUC viewer comes before graph views) |
| Scope of first releases | **Read-only tooling** (navigation, validation, viewing). Editing features come later. |
| Architecture | Language server logic **in-process first**, with clean module boundaries so it can be extracted into a standalone LSP later |

Priority legend: **P0** = foundation, **P1** = core value, **P2** = differentiator, **P3** = later (editing and advanced).

---

## 1. Feature Catalog

### Foundation

#### F0. Streaming parser and workspace index (P0)
- Parse all `.arxml` files in the workspace into an index of:
  - Elements (type, SHORT-NAME, full AR path, file, range)
  - References (source location, target path, `DEST` type)
  - UUIDs (where present)
  - Package merge info (the same AR-PACKAGE split across several files)
- Incremental re-index on file change via file watcher.
- Run off the main extension thread (worker thread) even while the server logic stays in-process.
- Start with an in-memory index; persist a cache only if cold-start time requires it.
- Status bar: `AUTOSAR: Classic 4.4.0 | Indexed: 245 files | Errors: 3`.

#### F1. Version detection and bundled schemas (P0)
- Detect the AUTOSAR schema version per file from `xmlns` / `xsi:schemaLocation`.
- Bundle the XSDs for supported Classic and Adaptive releases.
- Show the detected platform and version in the status bar.
- Handle mixed-version workspaces (each file validated against its own schema).

### Core

#### F2. ECUC viewer (P1)
- Render `ECUC-MODULE-CONFIGURATION-VALUES`, containers, parameters and references as readable tables or trees.
- Resolve parameter and container definitions (from `ECUC-MODULE-DEF`) to show proper names, types and units.
- Follow references between containers (jump to the referenced container).
- Search and filter by module, container or parameter.
- Read-only.

```
CAN Interface
  Channel:     CAN0
  Baudrate:    500 kbps
  Controller:  CAN_A
```

#### F3. ARXML outline tree (P1)
- Show AUTOSAR concepts instead of raw XML tags: packages, components, interfaces, ECU configuration.
- Hide structural tags such as `AR-PACKAGES` and `ELEMENTS`.
- Collapse and filter by concept; search within the tree.

```
📦 VehicleSystem
 ├── 📦 Components
 │    ├── 🚗 EngineController
 │    └── 🚗 BrakeController
 ├── 📡 Interfaces
 │    └── SpeedInterface
 └── ⚙ ECU Configuration
      ├── CanIf
      └── Com
```

#### F4. Reference navigation (P1)
- Go to Definition on any `*-REF` value (Ctrl+Click).
- Find All References for any element.
- Detect broken references.
- References are SHORT-NAME paths (for example `/Interfaces/SpeedInterface`), resolved through the index, not mapped to file names.
- Use the `DEST` attribute to check the expected target type.
- Handle package merging across files and report duplicate definitions of the same path.

#### F5. Semantic validation (P1)
Diagnostics beyond XML well-formedness and XSD validity:
- Broken references (error).
- `DEST` mismatch: the reference points to an element of a different type (error).
- Duplicate SHORT-NAME within a scope (error or warning).
- Duplicate UUIDs (warning).
- Port and interface rule violations, for example an R-PORT whose interface is missing or of the wrong kind.
- ECUC checks: parameter values missing for required definitions, multiplicity violations, references to missing containers.
- Rule severity and toggles configurable in settings.

#### F6. Element explorer and semantic search (P1)
- Side panel to search by element type, name, path or UUID.
- Result detail shows path, ports, interfaces and "used by".
- Example: search `ComSignal` and see each signal with the SWCs and CAN messages that use it.

#### F7. Schema-aware autocomplete and hover (P1)
- Child element completion driven by the XSD content model.
- Enum value completion.
- Reference value completion from the index (valid targets for the expected `DEST` type).
- Hover on a reference shows the target's type, path and a short summary.

### Differentiators

#### F8. Architecture graph views (P2)
- SWC view: components connected via ports and interfaces.
- Composition view: internal connectors of a composition.
- Adaptive view: service interfaces and application connections.
- Optional ECU / communication view.
- Webview using Cytoscape.js (interactive, large graphs) or Mermaid (simple, exportable).
- Click a node to jump to its source.
- Scale handling: filter, focus on a selected component, expand neighbors on demand.

#### F9. ARXML-aware diff (P2)
- Match elements by AR path / SHORT-NAME, not by line position.
- Ignore formatting changes, UUID changes and (configurable) ordering changes.
- Report added, removed, modified and renamed elements.
- Present as a summary view that links to a standard diff.

```
Modified: Port name
  Speed  →  VehicleSpeed
```

### Later: editing and advanced (P3)

#### F10. Rename refactoring
- Rename SHORT-NAME and update all references across files.

#### F11. Formatter
- Produces valid XML: consistent indentation and attribute wrapping.
- Preserves comments.
- Optional stable ordering of elements where AUTOSAR semantics allow it (off by default).
- Goal: minimal diffs against files produced by tools such as DaVinci or Tresos.

#### F12. Quick fixes and code generation helpers
- Quick fixes for common diagnostics, such as creating a missing interface.
- Templates for ports, interfaces and SWCs.
- CodeLens showing reference counts above elements.

#### F13. Standalone language server
- Extract the in-process language server into a separate LSP package once the module boundaries have proven stable.

---

## 2. Roadmap

### Phase 0: Foundation
- [ ] Project scaffolding, test harness, CI
- [ ] Streaming parser
- [ ] Workspace index with incremental updates
- [ ] Version detection and bundled Classic and Adaptive XSDs
- [ ] Status bar

### Phase 1: Navigation and ECUC MVP (read-only)
- [ ] Syntax highlighting for `.arxml`
- [ ] Outline tree and document symbols
- [ ] Element search
- [ ] Go to Definition and Find References
- [ ] Broken-reference diagnostics
- [ ] ECUC viewer (basic tree with resolved definitions)

### Phase 2: Intelligence (read-only)
- [ ] Full semantic validation rule set, including ECUC checks
- [ ] XSD-driven completion and hover
- [ ] ECUC viewer: reference navigation, search and filter

### Phase 3: Visualization and review
- [ ] SWC / composition graph (Classic) and Adaptive graph
- [ ] ARXML diff

### Phase 4: Editing
- [ ] Rename refactoring
- [ ] Formatter
- [ ] Quick fixes and CodeLens
- [ ] Code generation helpers

### Phase 5: Architecture
- [ ] Extract the standalone language server

---

## 3. VS Code API Mapping

| Feature | API |
|---------|-----|
| ECUC viewer, graph and diff views | Webview panels |
| Outline / breadcrumbs | `DocumentSymbolProvider` |
| Side-panel explorer | `TreeDataProvider` + view container |
| Go to definition | `DefinitionProvider` |
| Find references | `ReferenceProvider` |
| Clickable references | `DocumentLinkProvider` |
| Diagnostics | `DiagnosticCollection` |
| Completion / hover | `CompletionItemProvider`, `HoverProvider` |
| Rename (later) | `RenameProvider` |
| Formatting (later) | `DocumentFormattingEditProvider` |
| Status bar | `StatusBarItem` |
| Background indexing | Worker thread |

---

## 4. Architecture Notes

- Keep the core (parser, index, resolver, validator) in a separate module that does not import the `vscode` API. The VS Code layer should only adapt core results to providers and views.
- Define the core's interface as plain request/response functions (for example `resolveReference(uri, position)`, `getDiagnostics(uri)`), so moving to LSP later is a transport change, not a rewrite.
- Use a streaming parser; never build a full DOM for large files.

---

## 5. Key Risks

1. **Performance on large files:** ARXML files can reach hundreds of MB. Streaming parse and lazy loading are mandatory; set explicit targets.
2. **Reference semantics:** package merging, variation points and multiple schema versions make resolution more than a path lookup.
3. **ECUC complexity:** the viewer depends on correctly linking values to their `ECUC-MODULE-DEF` definitions, including vendor-specific module definitions and multiplicities.
4. **Bundled schema licensing and size:** confirm AUTOSAR XSD redistribution terms before shipping, and keep the extension package size reasonable across many releases.
5. **Classic vs Adaptive differences:** the two platforms have different element sets and conventions; keep platform-specific logic isolated.
6. **Graph scalability:** unfiltered graphs of real ECU projects become unreadable.
7. **Scope creep:** graphs and diff are each large. Ship the ECUC and navigation MVP first.
8. **Existing tools:** survey current ARXML extensions on the Marketplace to find gaps.

---

## 6. Testing and Sample Data

- Corpus of ARXML files: small hand-written fixtures plus a few non-confidential real-world files across schema versions, Classic and Adaptive, including ECUC examples.
- Unit tests for the parser and index (element extraction, reference resolution, package merging).
- ECUC tests: value-to-definition linking and multiplicity checks.
- Snapshot tests for diagnostics output.
- Performance benchmark on a large generated file.
- Integration tests with `@vscode/test-electron`.