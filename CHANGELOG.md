# Changelog

All notable changes to the ARXML Scope extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A resizable right sidebar with **Details** and **Conditions** tabs, collapsible sections and saved layout
- A single scrolling **Details** section that shows the node, value and formats, reference, conditions and annotations, with Jump to target and Reveal in source actions
- A **Search** field that runs on Enter, streams matches and the first match, highlights every match with a stronger current match, and moves instantly between matches with wrapped previous/next navigation; Search is the last control in the toolbar and its count keeps a fixed slot, so the field never shifts
- Search covers the text the Document shows, including the label, value, short name, variant, context, condition and annotation
- Search remains responsive on large files
- A **Conditions** panel that lists every `SW-SYSCOND` constant with an `unknown` state until a value is entered, stores values per workspace and dims rows disabled by a false condition
- A condition chip whose hover text lists each referenced system constant and its entered value on its own line, with `(not set)` for missing values
- Annotations render as italic comment lines directly above the node they describe, with module spacing above the comment
- Condition expressions use distinct token colours for names, numbers, operators and punctuation; long expressions stay compact in the tree and wrap fully in **Details**
- Condition constants discovered from the open document appear automatically; scanned constants are read-only and manual rows can be removed
- Condition values use icon-only Edit, Save and Cancel actions
- A read-only semantic diff for two ECUC-Values ARXML files, with aligned panes, **Show all** / **Show diff only**, Enter-driven Search, **Prev diff** / **Next diff**, **Swap sides** and reveal-in-source
- The diff shows each file with its schema/package header, annotations, braces and bracket guides, using the same colours and typography as the Document view
- Each diff pane has its own horizontal scrollbar; moving either one scrolls both sides in sync, and Shift+wheel over either pane does the same
- Two files with the same name are disambiguated by their shortest differing path in the diff title and pane headers
- The diff toolbar has no Filter, changes summary or global collapse/expand buttons; view and difference controls sit on the left, **Swap sides** is centred, and Search stays on the right; row-level collapse and both panes keep synchronized vertical scrolling
- A reusable `DocumentTreeView` component owns the Document header, native scroller, virtual spacers and rendered window; the editor mounts one instance and the diff mounts one per pane
- Each diff pane now virtualizes independently with its own native vertical and horizontal scrollbars, while either pane or bar drives the synchronized offsets
- Shift+wheel over either diff pane scrolls both horizontally; plain wheel stays vertical
- A right-click **Duplicate** / **Delete** menu on container and parameter rows; both ask for confirmation, container duplicates ask for a unique short name, and each action is one undoable edit
- An `ARXML Scope` context submenu for `Open with ECUC Editor` and `Reveal in ECUC Editor`

### Changed

- Recoverable ECUC warnings now appear beside the Conditions or Details panel they belong to, and page errors go to the webview debug console instead of the toolbar banner
- The diff panes share the editor's Document stylesheet and row builders through the component; status tint remains diff-only
- Swap sides resets both horizontal offsets while the vertical position is preserved

### Fixed

- The diff horizontal scrollbar is no longer clipped by a fixed 12px strip; both axes use the native scroller and keep the platform scrollbar height

### Removed

- The separate ECUC tree Filter field and its clear, count and empty-state UI; Search is now the only query control

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
