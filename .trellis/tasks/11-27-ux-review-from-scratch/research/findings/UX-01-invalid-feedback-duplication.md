# UX-01 — One invalid value is reported in four places, and the panel keeps stale derived values

- **Severity:** Major
- **Journey:** EDIT-05 (invalid value), EDIT-10 (rename refusal), CONT-01/02 (save blocked)
- **Gate:** Reflex — duplicate refusal channels
- **Heuristic:** Nielsen #4 consistency and standards, #8 aesthetic and minimalist design,
  #9 help users recognise/diagnose/recover
- **Confidence:** High — **host-confirmed in the deep pass** (`deep-edit-invalid`): the toolbar,
  editor strip, inline Details message and bottom status line all reported the same invalid draft;
  the blocked save left the file unchanged and the draft dirty. Host evidence:
  `research/evidence/host/deep-edit-invalid-workbench.png`,
  `research/evidence/host/driver-report-deep-all.json` (`edit-invalid.invalidChannels`).

## Repro

1. `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --state editor-invalid`
   (and `--state editor-rename-refusal`).
2. Type an invalid integer into the selected parameter's Value field in Details, then press
   `Ctrl+S`.

## Expected

One authoritative error next to the field that owns the draft, plus a compact blocked-save
signal. The documented rule is: "The Details status line carries follow failures and a field
refusal when the Details tab is hidden; field errors otherwise appear inline beside the control"
(`docs/user/ECUC_EDITOR.md`, *Details panel*). Derived numeric formats should not describe a value
that is not in the input.

## Actual

The same message is painted four times in one viewport:

| # | Location | Text | Colour |
|---|---|---|---|
| 1 | Editor toolbar, far left | `Invalid value — not saved` | red |
| 2 | Error strip above the Document | `Invalid value — Invalid integer value` | red |
| 3 | Details, under the field | `/* Invalid integer value */` | red |
| 4 | Details status line, bottom of the sidebar | `Invalid integer value` | amber |

Plus the red squiggle on the Document row. In `editor-rename-refusal` the same four channels
repeat for a refused short name, and the toolbar copy still says "Invalid **value**".

The Details panel also keeps showing **Decimal `0` / Hexadecimal `0x00` / Binary
`0b00000000`** while the draft reads `0abc`, i.e. the last accepted value is presented as the
current one. A user cannot tell whether the document holds `0`, `0abc`, or neither.

Evidence: `research/evidence/preview/editor-invalid.png`,
`research/evidence/preview/editor-rename-refusal.png` (both 1400×900, DPR 1).
Source: `src/webview/editorMonaco.ts` `updateErrorState()`/`updateDetailsError()`
(lines 735–782) always writes the Details status line; the same state also feeds the toolbar
status and the error strip.

## UX impact

The error is loud but not localised: the eye has to compare four copies that differ in wording
and in colour (red vs amber) and decide which one is authoritative. The stale Decimal/Hex/Binary
block actively contradicts the field above it, which is the one place the user is looking. In the
rename case the copy ("Invalid value") misnames the object being refused.

## Actionable fix

1. Keep **one** inline message under the edited field and one compact toolbar signal
   (`Save blocked`); drop the editor error strip while Details is visible, and write the bottom
   status line only when the Details tab is hidden (as documented).
2. Use one colour for one severity: the bottom status currently uses
   `editorWarning-foreground` for an error.
3. While a field is invalid, replace Decimal/Hexadecimal/Binary with a single muted
   `— invalid draft —` row (or omit the block) instead of showing the last accepted value.
4. Make the toolbar copy field-aware: `Invalid value`, `Short name refused`, `Save blocked`.

Not fixed in this task (review only).
