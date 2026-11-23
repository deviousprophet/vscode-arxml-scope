# Implementation plan — syscond and condition palette

## Phase 0 — Baseline evidence

- [ ] Capture the current `editor-syntax` condition row and Details condition code; note the
      uncolored Details spans and the current names/operators.
- [ ] Confirm the diff page imports the same tokenizer (`tokens.ts`) or record the limitation.
- [ ] Confirm both pages import `styles/tokens.css`.

## Phase 1 — Palette and token mapping

- [ ] Extend `EcucTokenType` with `syscond` and `constant` (or the smallest type addition the
      existing provider supports).
- [ ] Map `CONDITION_TYPES`: name→`syscond`, operator→`parameter`, literal→`constant`; leave
      number/string/punct.
- [ ] Add theme rules:
  - [ ] dark: `syscond #569CD6`, `constant #4FC1FF`;
  - [ ] light: `syscond #0000FF`, `constant #0070C1`;
  - [ ] `parameter` already supplies `#C586C0`/`#AF00DB`.
- [ ] Add token tests for all six syscond classes.

## Phase 2 — Shared CSS and surfaces

- [ ] Add `--tok-syscond`, `--tok-syscond-op`, `--tok-syscond-literal` to
      `src/webview/styles/tokens.css` with theme variables and Dark+ fallbacks.
- [ ] Add shared `.syscond-*` color classes in `tokens.css`.
- [ ] Remove the duplicate `.syscond-*` color rules from `documentTree.css`; keep the condition
      chip layout/state rules and set its base text color to `--tok-syscond`.
- [ ] Verify the Monaco page Details `condition-code` now receives the colors; no other page
      import is needed.
- [ ] Conditions panel:
  - [ ] condition name text/input → `--tok-syscond`;
  - [ ] true/false value text → `--tok-syscond-literal`, other values foreground;
  - [ ] condition state → literal/operator color with the existing border/ARIA cue.
- [ ] Check light/high-contrast readability; do not rely on color alone.

## Phase 3 — Preview and tests

- [ ] Add `editor-syscond` state selecting the Condition row.
- [ ] Add preview theme variables for the three new token colors.
- [ ] Audit:
  - [ ] tree condition chip has `.syscond-name`/`.syscond-operator`/`.syscond-literal`;
  - [ ] Details condition code has the same classes;
  - [ ] the condition state remains visible;
  - [ ] screenshot is clean.
- [ ] Add a CSS/load assertion that the syscond colors come from the shared stylesheet.
- [ ] Update `docs/WEBVIEW_PREVIEW.md`.

## Phase 4 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused token/CSS tests
- [ ] `npm test`
- [ ] `npm run shots:webview`
- [ ] `node esbuild.js --production`
- [ ] Inspect `editor-syscond` in dark and light previews.

## Result

Palette implemented and checked on 2026-11-23.

- Dark: syscond name `#569CD6`, operator `#C586C0`, literal `#4FC1FF`; light `#0000FF`,
  `#AF00DB`, `#0070C1`; numbers/strings/punctuation unchanged.
- `styles/tokens.css` owns the shared `.syscond-*` colors and the three `--tok-syscond*`
  variables; `documentTree.css` no longer duplicates them.
- Monaco editor and Monaco diff use the same token mapping; the Document tree chip, Details
  `Condition`/`Conditions` rows and Conditions panel use the shared palette. State keeps its
  border/ARIA cue.
- `editor-syscond` preview state/audit checks the editor chip, Details and Conditions panel;
  31/31 preview states clean.
- Full suite: 970 passing (two earlier runs hit unrelated extension-host flakes that pass in
  isolation). `check-types`, `lint`, production bundle pass.
- Limitations: the preview is dark-only; light/HC values are covered by CSS tests and a
  computed-style probe, not a screenshot. The shipped Monaco page has no Document tree; the
  legacy tree chip is covered by shared CSS/load tests. The diff fixtures contain no condition,
  so no diff screenshot shows the condition palette (the diff model inherits it).

## Review gates

- [ ] Syscond names match the C macro/preprocessor blue.
- [ ] Operators and literals are distinct; numbers/strings/punctuation are unchanged.
- [ ] Tree, Details and Conditions panel share the palette.
- [ ] No `.syscond-*` span is unstyled in the Monaco page.
- [ ] High-contrast and light themes remain readable.
- [ ] No duplicate syscond color rules remain in `documentTree.css`.
- [ ] Full suite, preview audit and production bundle pass.

## Rollback

- [ ] Revert the token type/mapping, theme rules, shared CSS and preview state. No data/protocol
      migration.
