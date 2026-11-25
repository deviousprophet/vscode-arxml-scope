# Restore full sticky headers in the diff

## Goal

The diff sticky scroll shows the full parent container or module header, matching the ECUC editor, instead of only `{`.

## Requirements

- Diff inner editors use the folding provider as the sticky-scroll source, like `createEcucEditor`.
- Folding and fold controls stay enabled on both inner editors.
- The sticky header text must be the full node line (indent, `module` prefix when present, label and metadata), not a brace-only line.
- Scrolling into a nested container shows the nearest parent header; scrolling out restores the outer header.
- Swap and one-sided documents keep the same text in the displayed pane.

## Acceptance criteria

- [ ] Both diff inner editors have `folding: true`, `showFoldingControls: 'mouseover'` and `stickyScroll: { enabled: true, defaultModel: 'foldingProviderModel' }`.
- [ ] At a deep scroll position the sticky header contains the parent label, not only `{`.
- [ ] The diff sticky text matches the editor's sticky text for the same container.
- [ ] A preview `diff-sticky` state captures the deep header and fails on `{`.
- [ ] Existing sticky editor state and full preview set still pass.

## Non-goals

- Custom sticky rendering.
- Sticky headers for parameter rows.
- Changing the sticky scroll debounce or height.
