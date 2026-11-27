# UX-004 — Details derived integer formats do not follow the local draft

- Severity: Minor
- Journey: EDIT-03
- Surface: ECUC editor / Details value
- Heuristic: usability (consistency, error prevention)
- Confidence: high (preview + host)

## Expected

The Details panel is "another view of the same in-memory draft" (`docs/user/ECUC_EDITOR.md`).
While the Value field holds a draft, the derived Decimal / Hexadecimal / Binary rows either
follow the draft or state that they still describe the last accepted value.

## Actual

`editor-dirty.png` shows:

- Value field: **042**
- Derived rows: **Decimal 0**, **Hexadecimal 0x00**, **Binary 0b00000000**

The document row agrees with the draft (`P0000 = 042`). The three derived rows show the old
value with no "accepted value" label, so the panel contradicts itself and gives a misleading
numeric interpretation while the user types.

## Repro

1. `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --state editor-dirty`
2. Read `editor-dirty.audit.json` (0 violations), then open `editor-dirty.png`.
3. Compare the Value field with Decimal / Hexadecimal / Binary.

## Evidence

- `research/evidence/preview/editor-dirty.png`
- `research/evidence/preview/editor-dirty.audit.json`

## Notes

`docs/user/ECUC_EDITOR.md` says integer values show all three formats and that Details and the
Document share one draft. If the stale rows are deliberate (only accepted values get derived
formats), the rows need a label such as "Last accepted" so the contradiction is explained.

## Host confirmation (2026-11-27)

Confirmed in the real Extension Development Host after inline typing `7` over `Keep = 1`:

- Value: **7**, document row: **Keep = 7**
- Decimal: **1**, Hexadecimal: **0x01**, Binary: **0b00000001**

Evidence: `research/evidence/host/edit-01-dirty-webview.png`. Confidence: **high**.
