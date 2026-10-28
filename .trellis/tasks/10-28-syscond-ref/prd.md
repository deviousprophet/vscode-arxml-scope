# Scanner: inline SYSC-REF dropped from SW-SYSCOND

## Goal

A variation-point condition may embed a system constant inline:

```xml
<SW-SYSCOND BINDING-TIME="CODE-GENERATION-TIME">
  (
  <SYSC-REF DEST="SW-SYSTEMCONST">/RB/UBK/Project/SwSystemconsts/CANIPCORETYPE_SC</SYSC-REF>
  ==0)
</SW-SYSCOND>
```

The scanner captures only raw character runs, so the reference disappears and the editor
shows `( ==0)` (with the surrounding formatting whitespace) instead of the legacy
`(CANIPCORETYPE_SC==0)`. Capture the inline reference as its path tail.

## Context (measured)

- Target: `Can_HVCANFD_EcucValues.arxml` — 14 `SW-SYSCOND` elements, all in the inline
  `SYSC-REF` form.
- Before the fix: 3 distinct condition texts, all of the shape `"(\r\n … ==0)"` (7 entries).
- Legacy baseline `.artext_cache/Can_HVCANFD_EcucValues.artext`: one condition,
  `[(CANIPCORETYPE_SC==0)]`, on 7 parameter lines.
- After the fix: 7 entries, all `"(CANIPCORETYPE_SC==0)"` — matches the baseline.
- Folder sweep (22 arxml, incl. 13.9 MB `comscl_netmtrx_signal_mapping_ecucvalues.arxml`):
  every condition resolves to a named constant; no empty or whitespace-only result.

## Requirements

- R1. A `SYSC-REF` directly inside `SW-SYSCOND` contributes its path tail (short name) to
  the condition text, at the position it occupied.
- R2. Formatting whitespace introduced by the XML line breaks between condition parts is
  not part of the text (`(\n <ref/> \n ==0)` → `(CANIPCORETYPE_SC==0)`). A condition with
  no inline reference keeps its own spacing verbatim.
- R3. Source ranges (`textStart` / `textEnd`) stay consistent with the captured text so
  existing range behaviour (selection, reveal) is unaffected.
- R4. No change to how `SW-SYSCOND` is located, nor to any other element's text.

## Acceptance Criteria

- [x] AC1. A condition of the inline form yields `(CANIPCORETYPE_SC==0)` (unit test with
      two parameters: plain `(A == B)` unchanged, inline reference substituted).
- [x] AC2. Target file: 7 conditions, all `(CANIPCORETYPE_SC==0)` (was 3 malformed
      variants at 7 entries).
- [x] AC3. Folder sweep: no empty / whitespace-only condition text.
- [x] AC4. `npm run check-types`, `npm run lint`, and the suite pass (220 tests).

## Constraints

- Scanner only; no renderer, provider or settings change.
- No new dependency.
- Keep the single-pass streaming design (no DOM, no second traversal).

## Out of scope

- Rendering conditions differently (brackets, `[ … ]` wrapper): the page already wraps
  what the model carries.
- Multi-level nesting of `SYSC-REF` inside other inline elements: not present in the
  sample set.
