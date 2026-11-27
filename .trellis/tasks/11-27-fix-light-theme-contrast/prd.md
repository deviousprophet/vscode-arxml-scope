# Fix light-theme toolbar contrast

## Goal

Close **UX-10** (Floor — contrast, Major): in VS Code Default Light Modern, 10–12 px toolbar
labels resolve to about **3.1:1** on white (`--tok-dim` ≈ `#939393`), so light-theme users cannot
read them reliably.

Source: `.trellis/tasks/11-27-ux-review-from-scratch/research/findings/UX-10-light-theme-label-contrast.md`.

## Requirements

1. Toolbar label text meets **4.5:1** in light and dark themes at 10–12 px; icons keep the 3:1 UI
   threshold. High-contrast must remain readable.
2. Use VS Code tokens (`--vscode-descriptionForeground` or a documented 75–80% foreground mix),
   never a literal colour. Separate the label token from the icon/meta token if their targets
   differ.
3. Apply to both the ECUC editor and diff toolbars; do not change the visual hierarchy or the
   toolbar geometry.
4. Add a regression check: the host `theme-zoom` scenario already measures label contrast in
   light/dark; it must pass 4.5:1. Add a focused unit/style assertion if the token is computed in
   one place.
5. Keep the preview dark capture visually unchanged within tolerance.

## Acceptance criteria

- [ ] Light-theme editor and diff toolbar labels measure ≥ 4.5:1; icons ≥ 3:1.
- [ ] Dark and high-contrast remain readable.
- [ ] No toolbar layout/width change; labels still hide only on real overflow.
- [ ] Host `UX_HOST_ONLY='theme-zoom'` passes the label-contrast checks.
- [ ] Preview `editor`/`diff-merge` audits still pass.
- [ ] `npm run check-types`, `npm run lint`, `npm test` pass.

## Non-goals

- A theme redesign or new tokens.
- The other light-theme surfaces (report them separately if found).
- Toolbar/overflow behavior (UX-04, child 3).
