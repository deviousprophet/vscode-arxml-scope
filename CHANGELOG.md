# Changelog

All notable changes to the ARXML Scope extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-11-05

### Added

- Copy-aware reference resolution: a target declared in several files resolves to the copy in the referencing file, and **Go to Definition** / **Find References** expose every copy instead of guessing
- `arxmlScope.index.exclude` for workspace-relative globs (`**/_fwd/**`, `**/_out/**`, `**/_gen/**`) that keeps generated or duplicate trees out of the index, validation, navigation and text-editor features
- `arxmlScope.validation.crossFileRules` (`auto` / `always` / `never`) so a workspace without ECUC definitions stays quiet; the status bar shows the mode and cycles it
- `arxmlScope.validation.maxDiagnosticsPerFile` and `maxDiagnostics` caps, with one summary diagnostic per file that reports hidden problems
- `arxmlScope.diff.semanticMatching` for renamed-container pairing; the **Semantic** / **Strict** view group switches immediately between the cached views and renamed containers stay one changed row without a special marker
- A default-on **Context** toggle that keeps five unchanged lines above and below each change, plus expandable split lines that reveal the hidden runs in Show diff

### Changed

- The diff toolbar is now a grouped icon-over-label strip: **Show all** / **Show diff**, **Context**, **Semantic** / **Strict** and **Prev diff** / **Next diff**, with **Swap sides** centered over the pane divider and Search on the right

### Fixed

- Validation no longer reports parameter-value or non-ECUC `DEST`s as broken references, and a duplicate AR path across generated copies is one `information` diagnostic with related locations instead of thousands of errors
- Multiplicity is counted inside one file and one owning parent, so cross-file copies are not summed
- Empty values and AUTOSAR boolean/float literals (`0`/`1`, `INF`, `-INF`, `NaN`) are accepted; required `ECUC-ADD-INFO-PARAM-DEF` children and required children with a `DEFAULT-VALUE` are no longer missing
- Missing definitions are grouped at the highest missing ancestor (or the missing module definition) with an instance count
- **Details** reports `N definitions found` when several definition bodies share a path instead of silently dropping the definition block
- Added diff rows use the same bold leading edge as removed rows
- The diff pane chevron and collapsed `{ ... }` marker follow the live `aria-expanded` state, and selection uses the same document-tree treatment in both panes
- Only the diff file name stays pinned above the rows; schema and package lines are part of the scrolling content. Both diff panes scroll natively, the right pane hides its vertical scrollbar without reserving a gutter, and the follower pane renders on the next animation frame so the wheel step matches the editor

## [0.6.0] - 2026-11-03

### Added

- Cross-file **Jump to target** for references, with a **Find references** action that lists every indexed instance and reference and reveals the chosen hit
- ECUC validation diagnostics for broken references, `DEST` mismatches, duplicate short names, out-of-range or wrong-typed values, multiplicity violations, missing definitions and missing required containers, parameters or references
- Per-rule validation severity settings, including `off`, and an `arxmlScope.validation.enabled` switch
- Plain-text editor support for ARXML: outline and breadcrumbs, **Go to Definition**, **Find References**, clickable `*-REF` links and hover with definition type, range, multiplicity and description
- Validation diagnostics in the Problems panel and as text-editor markers

### Changed

- A reference that cannot be resolved across the workspace now shows the reason in **Details** instead of silently hiding the jump action
- Definition details refresh when a definition file is saved, and validation is recomputed after every index change

## [0.5.0] - 2026-11-03

### Added

- An in-memory workspace index over every `.arxml` file, rebuilt on activation and kept current as files are created, saved or deleted
- A status bar item showing how many files are indexed, with element, reference, definition and package counts in its tooltip and a click action that rebuilds the index
- ECUC definition details in **Details** for modules, containers, parameters and references: declared type, range, default, multiplicity, enumeration values, destination type and description
- Definition provenance in **Details**, naming the module-definition file that supplied the resolved data
- `ARXML Scope: Rebuild Workspace Index` and the `arxmlScope.index.enabled` / `arxmlScope.index.maxFileSizeMB` settings

### Changed

- A saved module-definition file refreshes definition details in an already open ECUC editor
- Module-definition files are indexed as data even though they still open in the text editor

## [0.4.0] - 2026-11-01

### Added

- A resizable right sidebar with **Details** and **Conditions** tabs, collapsible sections and saved layout
- A single scrolling **Details** section showing the node, value and formats, reference, conditions and annotations, with Jump to target and Reveal in source
- Recoverable ECUC warnings beside the Conditions or Details panel they belong to, while page errors go to the webview debug console
- A **Search** field that runs on Enter, streams matches, highlights all and the current match, and moves with wrapped previous/next; it sits last in the toolbar with a fixed count slot
- Search covers the label, value, short name, variant, context, condition and annotation, and stays responsive on large files
- A **Conditions** panel that lists every `SW-SYSCOND` constant, stores values per workspace, dims rows disabled by a false condition, auto-discovers constants that can be edited, and keeps icon-only Edit/Save/Cancel actions; only manually added rows can be removed
- A condition chip tooltip that lists each referenced constant and its entered value, one per line, with `(not set)` for missing values
- Annotations render as italic comment lines directly above their node
- Condition expressions use distinct token colours, stay compact in the tree and wrap fully in **Details**
- A read-only semantic diff with aligned panes, **Show all** / **Show diff only**, Enter-driven Search, **Prev diff** / **Next diff**, **Swap sides**, reveal-in-source, live refresh and no blank line between modules
- The diff renders each file's schema/package header, annotations, braces and bracket guides with the Document colours and typography, and the header scrolls with the content
- Changed diff rows highlight the exact words that changed in both panes, with removed/inserted colours and search marks kept visible
- Selecting a container highlights the annotations of its whole subtree in the Document view and in both diff panes, with the same selection mirrored across panes
- Each diff pane has its own native vertical and horizontal scrollbars, unclipped; moving either pane or bar keeps both synchronized
- Swap resets only the horizontal offset while the vertical position is preserved
- Shift+wheel over either diff pane scrolls both horizontally
- Same-named files are disambiguated by their shortest differing path in the diff title and pane headers
- The diff toolbar keeps view and difference controls on the left, **Swap sides** centred and Search on the right
- One shared `DocumentTreeView` component renders the Document view and each diff pane, with an independent virtual window per pane
- A right-click **Duplicate** / **Delete** menu on container and parameter rows, with confirmation and one undoable edit
- An `ARXML Scope` context submenu for `Open with ECUC Editor` and `Reveal in ECUC Editor`

## [0.3.1] - 2026-10-29

### Fixed

- The ECUC editor now loads in a packaged install instead of failing to start with a webview error and an empty tree

## [0.3.0] - 2026-10-29

### Added

- Container `Short name` and `Definition` are editable in the details panel, each written as one undoable edit that leaves the tag, `DEST` and surrounding bytes untouched
- The details inspector is open on first paint, and an explicit hide or show is still remembered
- Distinct Collapse and Expand toolbar icons that show the direction each control moves the tree

### Changed

- A refused field edit is shown beside the field in the details panel instead of repeating under the filter bar; the toolbar notice remains the fallback when the panel is hidden

### Fixed

- A page that fails to start now reports the error in the ECUC editor notice and names the `Developer: Open Webview Developer Tools` command
- Variation-point conditions that embed a `SYSC-REF` inline now show the constant name instead of `( ==0)`

## [0.2.0] - 2026-10-28

### Added

- A new extension icon, shown in the Marketplace listing and the Extensions view

## [0.1.0] - 2026-10-28

Initial ECUC editor release.

### Added

- An opt-in ECUC-Values editor for `.arxml` files, available from the command palette, Explorer and editor context menus, and *Open With…*
- A Document view with editor-style folding, bracket guides, collapse/expand, filtering and virtual scrolling
- A details panel that shows the AUTOSAR type, Decimal/Hexadecimal/Binary values, target, context, conditions and annotations
- Type-aware parameter editing: integer/hex/binary literals, decimal floats, a Boolean selector and text values
- Same-file reference navigation through the details **Jump to target** action
- Reveal in source and Source → ECUC editor navigation
- Ordering and sort-exception settings matching the legacy ARTEXT tool
- Validation before every write, with refusals that keep the file unchanged
- Read-only CDATA values and no derived files, caches or indexes beside user files
