# Route recoverable warnings out of the toolbar notice

## Goal

Remove the persistent yellow warning under the Filter/Search bar for recoverable problems. Invalid
condition names belong beside the Conditions table; edit, follow and reveal errors belong in the
Details panel. The toolbar notice remains only as the fatal page-boot error surface.

## Confirmed facts

- `#notice` sits directly under the toolbar and is the yellow banner the user sees
  (`src/editor/renderHtml.ts`).
- The host posts `{ type: 'notice', message, kind: 'warn' }` for:
  - invalid condition names after a `conditions` message (`ecucEditorProvider.ts:213`);
  - follow/reveal failures (`:306`, `:313`);
  - edit refusals (`:353`, `:367`, `inline: true`).
- The page writes every non-inline notice into `#notice` and never clears it on a later successful
  action or re-scan (`renderHtml.ts` message handler).
- Field refusals already render inline in the details field; the toolbar notice is only a fallback.
- `#conditions-status` is an existing live region inside the Conditions section.
- The boot error surface uses `#notice` through `pageErrorScript`; it must keep a visible surface.

## Requirements

- **R1** Recoverable condition-name warnings render in `#conditions-status` inside the Conditions
  tab, not in the toolbar notice.
- **R2** Follow/reveal failures render in a small `#details-status` live region in the Details tab,
  not in the toolbar notice.
- **R3** Edit refusals stay inline beside the edited field; if the details panel cannot show them,
  they go to `#details-status`, never the toolbar.
- **R4** Recoverable messages clear when the problem is resolved:
  - `#conditions-status` clears when every condition name is valid (existing input behavior);
  - `#details-status` clears on the next `select` or `model` message.
- **R5** The toolbar `#notice` is written only by the fatal page boot-error surface. No host
  `notice` message may set the yellow toolbar banner.
- **R6** No new dependency, file write, hard-coded colour or inline style. Status text uses theme
  colours and `textContent`.
- **R7** Existing boot-error reporting, field refusal behavior and accessibility live regions keep
  working.

## Acceptance criteria

- [ ] **AC1** An invalid condition name shows the warning in the Conditions section; the toolbar
  notice stays empty.
- [ ] **AC2** Correcting the names clears the Conditions warning.
- [ ] **AC3** A follow/reveal failure shows in the Details tab; the toolbar notice stays empty.
- [ ] **AC4** The Details warning clears on the next selection or model refresh.
- [ ] **AC5** A refused field edit still shows inline in the Details field, with no toolbar banner.
- [ ] **AC6** A page that fails to boot still shows the fatal error in `#notice`.
- [ ] **AC7** All existing notice, editing, Conditions, sidebar and search tests pass; new tests cover
  the routing and clearing.
- [ ] **AC8** No file write, dependency, colour literal or inline style is introduced.

## Out of scope

- Removing the boot-error surface entirely.
- Toasts, auto-dismiss timers or a notification history.
- Changing the text of any warning.
- Changing the Conditions or Details layouts beyond adding a status line.

## Notes

- Lightweight task: `prd.md` is the only planning artifact.
- The change is host message routing plus page handlers; no model or evaluator change.
