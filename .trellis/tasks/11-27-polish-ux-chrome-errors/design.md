# Design — polish UX chrome and errors

## Sidebar toggle

Owner: `src/webview/components/toolbar/toolbar.ts`/`.css`. Use the neutral tool style; keep the
pressed state via `aria-pressed` and a subtle background, not the primary blue block.

## Diff toolbar labels

Owner: toolbar CSS/JS. Current media-query/class breakpoint drops all labels at 1024 even though
the 1400-width labeled strip uses 588 px. Change the breakpoint to a measured/container-based
condition (or raise the threshold) so labels remain at 1082 px. When space truly runs out,
collapse secondary controls into a labelled overflow menu; never leave Merge as an anonymous
glyph.

Tests: preview `toolbar-1400/1200/1024/900/800/640`; host `diff` at 1082 px.

## Diff default/Context/change count

Owner: `src/webview/diffMonaco.ts` toolbar state + diff render. Decide and document one default:
either Show diff with a change count, or Show all with Context enabled. Do not render a disabled
button as pressed. The change count should come from the existing diff model; if intentionally
absent, state that in the toolbar/status copy.

Tests: preview `diff-off`/toolbar states; host `diff`.

## Activation error copy

Owner: `src/host/engine/engineLoader.ts` / activation error. Keep the actionable persistent
failure; remove the protocol constant and source-checkout `npm` guidance from the user message.
Put details in the output channel. Tests: host `missing-engine`.

## Diff find count

Owner: the native find bridge (`src/webview/monaco/findBridge.ts` or diff find integration). The
count must reflect the first/current match (`1 of 3`), not `?`; verify after Enter and next.
Tests: host `diff`; unit around the find bridge if the count is computed there.

## Gate, diff, merge, index and reveal copy (UX-11…UX-15)

- **Gate copy:** in `src/host/` open-command path, either open the text editor after refusing a
  non-ECUC file or change the copy to “has no ECUC values” and add **Open as Text**. Test host
  `first-gate` for empty, malformed and non-ECUC files.
- **Diff stale side:** `src/webview/diffMonaco.ts`/host notice. A diff-specific message names the
  stale side, says the comparison stopped updating, and offers **Reload comparison** / **Open as
  Text**. Test `diff-side-not-ecuc`.
- **Merge missing module:** `src/host/diffPanel.ts` refusal. Name the module and add a **Reveal
  module** action; “copy it first” alone is circular. Test `merge-collision`.
- **Index skip reason:** `src/host/indexService.ts`. Record `too-large`, `unsupported-encoding` or
  `unreadable` per file and render one reason with the threshold. Test `index-toggles`.
- **Reveal replace:** `src/host/navigation.ts`. Close the custom editor after the text editor is
  shown in `replace`, or rename the custom tab and document it. Test `reveal-modes`.

## Dirty-status layout stability (UX-16)

The `● Unsaved changes` span is the first flex item before Collapse/Expand. When it appears it
takes 106.25 px and moves both buttons by 112.25 px. Give the status a reserved slot, move it after
the controls, or place it in the free space before the sidebar; keep `role="status"` and
`aria-live`. Add a preview cross-state assertion (`editor` vs `editor-dirty`) for the button x
positions; fail on >1 px. Evidence: `research/evidence/dirty-toolbar-shift.json`.

## Rollback

Revert the child branch; no migration.
