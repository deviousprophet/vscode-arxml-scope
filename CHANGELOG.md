# Changelog

All notable changes to the ARXML Scope extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A right-side Hex Scope-style sidebar with **Details** and **Conditions** tabs, resizable and collapsible sections, draggable sashes and persisted layout
- A **Search** field that finds within the current filter result, jumps to the matching row, and supports wrapped previous/next navigation
- A read-only semantic diff for two ECUC-Values ARXML files, with aligned panes, changes-only filtering, previous/next navigation, reveal-in-source and live refresh as either file is edited
- A `Conditions` panel that lists every `SW-SYSCOND` constant in the open document with an `unknown` state until a value is entered; values are stored per workspace, false conditions dim their rows, and unresolved conditions stay active

### Changed

- The Conditions table moved from the toolbar into the sidebar and now uses explicit Edit/Save/Cancel; scanned constants are read-only and cannot be removed
- The toolbar Filter and Search fields, primary/secondary/add/danger buttons and row actions share the Hex Scope control style
- `Open with ECUC Editor` and `Reveal in ECUC Editor` now live under the `ARXML Scope` submenu; `Reveal in ECUC Editor` is only offered in a text editor

### Fixed

- The ECUC editor filter box shows a single clear button

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
