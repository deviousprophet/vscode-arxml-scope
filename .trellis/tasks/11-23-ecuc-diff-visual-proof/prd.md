# Prove the diff body against VS Code

## Goal

Provide trustworthy visual proof that the ECUC diff body matches the shipped VS Code diff body:
a checked-in reference capture plus an automated audit of the real rendered body. A screenshot that
looks plausible is not enough; the audit must fail when the body is wrong.

## Requirements

- **Fixed state**
  - Add a deterministic preview state `diff-body-reference` with changed, added, removed, renamed,
    one-sided, condition and nested rows, merge mode, and Show diff + Context.
  - The same state is captured for the reference and for the ARXML body.
- **Reference**
  - Capture the shipped VS Code `^1.125` built-in diff body (text pair with the same chrome
    settings) at Dark+ and Light+; add a high-contrast smoke capture.
  - Check in the reference image(s) and a machine-readable reference spec: gutter widths, line
    number column, margin geometry, font/line height, indentation/density, diff color roles,
    unchanged-widget geometry, ruler marks. State clearly that the reference is for the diff body
    chrome, not the ECUC semantic content.
- **Automated body audit**
  - Read the real ARXML diff page: Monaco models, decorations, DOM classes and computed styles.
  - Assert +/− signs and copy-arrow merge margin (owning side only; no duplicate revert icon).
  - Assert line/word fill roles and no paint on missing-side placeholders.
  - Assert native unchanged-region widget geometry/labels/show-all behavior.
  - Assert semantic ruler marks and previous/next targets.
  - Assert font/line height/indentation/gutter/density against the reference spec with explicit
    tolerances.
  - Dark+ and Light+ are full audits; HC is a smoke audit.
- **Negative controls**
  - Removing the body layer/CSS, reverting a required class, painting a placeholder, or restoring
    the old margin must fail the audit.
- **Docs**
  - Update `docs/WEBVIEW_PREVIEW.md` with the state, reference location, audit scope and the
    chrome-vs-content caveat. The screenshot harness must not claim a pass when the model/body is
    unavailable.

## Acceptance Criteria

- [ ] The reference image(s) and machine-readable spec are checked in and traceable to VS Code
      `^1.125` / Monaco `0.57.0`.
- [ ] `diff-body-reference` captures the real ARXML body in Dark+ and Light+; HC smoke.
- [ ] The audit reads the actual models/DOM/computed styles and checks every body affordance.
- [ ] Negative controls fail the audit; no false-green capture.
- [ ] The audit and screenshots pass in `npm run shots:webview`.
- [ ] Full suite and production bundle pass.

## Notes

- Branch only after PR #40 merges and the body/unchanged children are merged (or their final
  DOM/class contract is stable): create `feat/ecuc-diff-visual-proof` from latest `main`.
- Do not copy local sample files or VS Code source. The reference image is documentation/test
  evidence, not product code.
