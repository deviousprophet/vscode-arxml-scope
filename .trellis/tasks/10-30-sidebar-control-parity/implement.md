# Parent implementation plan

The parent does not implement code. It sequences the children and runs the integration gate.

## Ordered checklist

- [ ] Start and finish `10-30-sidebar-shell-buttons`.
  - Gate: tabs, width resizer, sections/sashes, Details migration, shared button/field CSS, boot
    check, full suite.
- [ ] Start and finish `10-30-conditions-edit-flow` inside the new Conditions tab.
  - Gate: badge, scanned/manual rules, Edit/Save/Cancel, Add/Clear, message boundaries, full suite.
- [ ] Start and finish `10-30-find-bar-search` with the new toolbar field styles.
  - Gate: filtered candidate set, jump, counts, keyboard, filter unchanged, full suite.
- [ ] Parent integration review:
  - Both tabs and all sections resize/collapse/persist correctly.
  - Every button uses the shared hierarchy.
  - Filter and Search share the field style and do not interfere.
  - Conditions edit flow and Find behavior work together.
  - No toolbar Conditions/Details toggle remains.
- [ ] Spec update: sidebar/tab/section/button conventions; remove the old inspector-hidden rules.
- [ ] `CHANGELOG.md` updated for the sidebar/control redesign.
- [ ] Archive children, then parent.

## Validation commands

```text
npm run check-types
npm run lint
npm test
npm run package
```

`npm run package` runs the production webview boot gate.

## Integration gates

- **After child 1:** the page boots with the sidebar; `#inspector` still exposes the details fields;
  the old toolbar toggles are gone; no test still asserts the flat aside.
- **After child 2:** scanned rows have no Remove, manual rows do; Save/Cancel produce exactly one
  message per commit; the unknown badge is correct.
- **After child 3:** Search finds only filtered rows, jumps without hiding, and leaves the filter
  count/visibility unchanged.

## Risks

- Full pane parity is the largest risk; port the allocation/sash behavior and test the math.
- `renderHtml.ts` is shared by all three children; land child 1 first and keep child 2/3 edits
  scoped to their content areas.
- Details test churn is expected; preserve ids/classes and adapt assertions rather than weakening
  them.
- Do not keep the old toolbar panel as a fallback; one panel surface only.

## Rollback points

Each child is one commit. Child 1 rollback restores the aside/top-panel layout; child 2/3 rollbacks
are independent. The diff page is untouched.
