# Use the built-in VS Code diff gutter and sash

## Goal

Make the ARXML Scope diff view a **modified version of the VS Code 1.125 / Monaco 0.57 diff view**, not a rebuilt margin or a screenshot-matched imitation. The built-in diff editor owns the per-side synthetic body, native paint, hover gutter, hunk toolbar and resizable sash. Only the ARXML Scope toolbar, the synthetic ECUC content, the copy actions and their hunk→row adapter are ours.

This task starts fresh from `main`; the abandoned `feat/ecuc-diff-body-surface` branch and PR #41 are closed/deleted and are not a dependency.

## Confirmed decisions

- **Integration:** use the built-in `renderGutterMenu` path (`DiffEditorGutter`, `DiffToolBar`, `DiffEditorSash`) already present in `monaco-editor@0.57.0`; register ARXML actions through a small internal adapter. Do not vendor or rebuild the gutter/toolbar/sash.
- **Body:** rebuild the per-side synthetic ECUC body and native paint (no blank placeholders, no custom fills/signs/word spans/selection tint/overview-ruler decorations).
- **Gutter/sash lifetime:** keep the 35px gutter and sash mounted in all modes. Merge only gates the copy buttons; panes resize in every mode.
- **Actions:** two hunk actions, **Copy Block to Left** and **Copy Block to Right**, icons `arrowLeft`/`arrowRight`; hide the built-in “Revert Block” and do not add a third action.
- **Availability:** changed pairs show both actions; a left-only hunk shows only Right; a right-only hunk shows only Left. The impossible direction must not be rendered as a dead button.
- **Hover:** keep VS Code’s `showAlways` for the hunk under the cursor inside Merge; other hunks reveal on gutter hover. Outside Merge all copy buttons are hidden.
- **Short-hunk overflow:** keep VS Code’s `maxItems: 1` behavior. A hunk that starts at line 1 and is shorter than 30px shows “More Actions…”; the submenu contains the correctly labeled copy actions.
- **Mapping:** a hunk action targets the topmost semantic row in the hunk; copying a container row’s cell range carries its subtree.
- **Swap:** Left/Right refer to the displayed panes; the host receives the stored side that owns the displayed source.
- **Ratio:** 50/50 default, drag, double-click reset, keep across document updates and Swap, no persistence.
- **Toolbar:** keep the current ARXML Scope toolbar and behavior; VS Code’s editor-title diff toolbar is out of scope.
- **Proof:** code-level parity, not capture parity. Check in a parity manifest, assert the pinned Monaco version and upstream file hashes, and audit the real gutter/sash DOM/actions.

## Requirements

- **Built-in diff view**
  - Use the VS Code/Monaco diff editor options and UI code: `renderGutterMenu: true`, `enableSplitViewResizing: true`, side-by-side layout, native indicators, fills, word spans, overview ruler and unchanged widgets.
  - Add the intentional modified feature: enable folding in both diff panes and make the ARXML Collapse/Expand toolbar actions fold/unfold both sides like the single-document editor.
  - Remove every custom merge margin/arrow/overlay/view zone, placeholder decoration/mask, custom selection/subtree tint, custom semantic ruler and custom arrow CSS.
  - Keep the ARXML toolbar, search, collapse, Show all/diff and semantic Prev/Next behavior.
- **Per-side body**
  - Build left and right synthetic ECUC documents from each side’s own rows; no blank placeholder lines or synthesized braces.
  - Keep per-side line numbers, folding, row/line maps, and native diff paint.
  - One-sided blocks show the built-in diagonal gap on the missing side.
- **Hover gutter actions**
  - Register exactly two ARXML actions on the built-in hunk toolbar.
  - Hide the built-in Revert action; no third button.
  - Show only the meaningful direction on one-sided hunks; both on changed pairs.
  - Use the displayed-pane direction under Swap.
  - Actions post the existing host `copy` with the topmost row key and the stored side that owns the displayed source.
  - The synthetic models remain read-only; the actions never edit them.
- **Resizable sash**
  - Enable the built-in sash; live 50/50 default, drag, double-click reset, keep ratio across model updates/Swap.
- **Code parity**
  - Pin `monaco-editor@0.57.0` (VS Code 1.125.0).
  - Check in `docs/vscode-diff-parity.md` with upstream paths and our adapter files.
  - Test the package version/integrity and hashes of the upstream gutter/sash/diff-editor files.
  - Source tests assert the built-in options, action registration and absence of custom margin classes.
  - Runtime preview tests assert `.gutter`, `.gutterItem`, `.sash`, action labels, Merge gating, hover/current-hunk, pane resize and host copy messages.
- **Full sweep**
  - Audit the diff editor surface against VS Code 1.125: gutter/sash, hunk toolbar, hover/focus, overview ruler, unchanged widgets, indicators/fills, scrollbars, accessibility names and Merge behavior; fix every difference found.

## Non-goals

- VS Code editor-title diff toolbar.
- Selection hunk toolbar and copy-on-selection.
- Accessible diff viewer overlay.
- Inline/compact diff mode.
- Ignore-whitespace behavior.
- Reference-image or pixel-diff proof.

## Acceptance criteria

- [x] The page enables `renderGutterMenu` and `enableSplitViewResizing`; no custom margin/arrow/overlay/glyph merge classes remain.
- [x] Per-side synthetic documents differ in line count; one-sided gaps use native diagonal fill; no blank numbered placeholders or custom body paint.
- [x] Inside Merge, hovering a hunk reveals the built-in toolbar; the current hunk uses VS Code’s `showAlways`; outside Merge no copy buttons are visible.
- [x] Changed pairs show both copy actions; one-sided hunks show only the meaningful direction; labels/tooltips are exactly “Copy Block to Left/Right” with matching icons and aria labels.
- [x] The built-in Revert action is absent.
- [x] Copy actions target the topmost semantic row and post the correct host side/key under Swap.
- [x] Panes resize in Merge and non-Merge modes; 50/50 default, drag, double-click reset, ratio survives document updates and Swap.
- [x] The diff panes expose folding controls; the ARXML Collapse/Expand toolbar buttons fold/unfold both sides and restore the original visible rows.
- [x] The ARXML toolbar and semantic navigation/search/collapse/Show all-diff behavior remain.
- [x] The code-parity manifest, version/integrity/file hashes and source/runtime tests pass.
- [x] Full test suite, preview audit, lint, fallow, production bundle and `git diff --check` pass.
