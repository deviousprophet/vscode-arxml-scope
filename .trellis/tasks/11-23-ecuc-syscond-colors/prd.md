# Improve ECUC syscond and condition colors

## Goal

System-condition expressions should read like C macro/preprocessor code in every ECUC surface:
the Monaco editor, the Document tree condition chip, the Details `Condition`/`Conditions` rows,
and the Conditions panel. The current palette uses variable blue for syscond names and keyword
blue for operators/literals, and the `.syscond-*` CSS is only loaded by the legacy tree page, so
Details condition code is uncolored.

## Requirements

- Use the C macro/preprocessor color for syscond names/references:
  - dark `#569CD6` (Dark+ `meta.preprocessor` / `entity.name.function.preprocessor`);
  - light `#0000FF` (Light+ same scopes).
- Give the expression readable separation:
  - operators `#C586C0` dark / `#AF00DB` light;
  - literals (`true`/`false`) `#4FC1FF` dark / `#0070C1` light;
  - numbers `#B5CEA8` / `#098658`, strings `#CE9178` / `#A31515`, punctuation
    `#808080` / theme foreground — unchanged.
- Apply the palette to:
  - Monaco's semantic tokens for every syscond token kind;
  - the Document tree condition chip and its token spans;
  - the Details `Condition` and `Conditions` rows (they currently render token spans with no
    matching CSS in the Monaco page);
  - the Conditions panel name/state text where condition text is shown;
  - the diff view if it uses the same tokenizer (verify; otherwise state the limitation).
- Move the `.syscond-*` color rules out of `documentTree.css` into a shared stylesheet loaded by
  both the Monaco page and the legacy tree page. Keep component layout rules where they belong.
- Follow the theme for dark/light/high-contrast; do not hard-code a single-theme color where a
  VS Code theme variable exists. Use fixed Dark+/Light+ fallbacks only where the theme does not
  provide a token variable.
- Do not rely on color alone for condition state; keep the existing border/ARIA cues.
- Add a preview state and screenshot with the Condition row selected and Details showing the
  condition code; add the preview theme variables needed for the new tokens.
- Add token-mapping tests for every syscond class and a CSS/shared-load check.

## Acceptance Criteria

- [ ] In dark theme, syscond names/references are `#569CD6`, operators `#C586C0`, literals
      `#4FC1FF`; numbers/strings/punctuation keep their current colors.
- [ ] In light theme, the corresponding Light+ colors are used.
- [ ] The Document tree condition chip, Details `Condition`/`Conditions` rows and the Conditions
      panel all show the same palette; no `.syscond-*` span falls back to plain foreground in the
      Monaco page.
- [ ] High-contrast and high-contrast-light remain readable.
- [ ] A preview state shows a selected condition row with Details open and the condition tokens
      visible; the audit/screenshot are clean.
- [ ] Token-mapping tests cover name, operator, literal, number, string and punctuation.
- [ ] `npm run check-types`, `npm run lint`, focused tests, full tests, `npm run shots:webview`
      and the production bundle pass.
- [ ] The task result lists the exact palette and any surface that could not share the tokenizer.

## Notes

- The C macro color is the VS Code Dark+/Light+ preprocessor scope color, not a new arbitrary hue.
- The sample pair task provides a large condition-bearing document for visual verification; the
  existing `editor-syntax` state is enough for the first implementation.
