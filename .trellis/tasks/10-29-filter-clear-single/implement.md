# Single filter clear button — implementation plan

## Checklist

- [ ] Add the `::-webkit-search-cancel-button` / `::-webkit-search-decoration` suppression next to
  the `.filter` rules in `src/editor/renderHtml.ts` (`STYLE`).
- [ ] Add a regression assertion in `src/test/editor/uxFilter.test.ts` or `uxPolish.test.ts`:
  - the page contains the suppression rule;
  - `.filter-wrap` contains exactly one `filter-clear` button.
- [ ] Run `npm run check-types && npm run lint && npm test`.
- [ ] Manual check in the Extension Development Host: type a filter, confirm one X; click it,
  confirm the filter clears and focus returns to the input.

## Review notes

- Do not change `type="search"` to `type="text"`; the native role and Escape behaviour are wanted.
- Keep the CSS inside the nonce-carrying `<style>` block; a `style` attribute is blocked by CSP.
- Chromium/Electron is the only target, so the vendor pseudo-element rule is sufficient.

## Rollback

Remove the two suppression rules and the regression assertion. No behaviour beyond the duplicate
glyph changes.
