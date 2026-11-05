# Implement — synced horizontal bars and split alignment

1. Add `syncHorizontal` to VirtualScroll; mirror bar offsets in `onHorizontalBarScroll`.
2. Pass `syncHorizontal: true` from DiffView.
3. Measure the vertical scrollbar width and write `--diff-scrollbar-width` on `#diff-body`.
4. Size the title strip and horizontal-bar row with the gutter variable.
5. Add tests for synced bars, gutter measurement and title CSS.
6. Run `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark`, `npm run package`, `npx @vscode/vsce ls`.
7. Commit, archive the task, push and confirm CI.

## Gates

- **A:** both diff panes move to the same horizontal offset.
- **B:** title and pane split line up with/without the gutter.
- **C:** full suite, benchmark, package and CI green.
