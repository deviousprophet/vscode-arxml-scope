# Design — syscond and condition palette

## 1. Current state

- `src/webview/monaco/tokens.ts` maps the shared condition lexer:
  - `syscond-name` → `variable`
  - `syscond-number` → `number`
  - `syscond-string` → `string`
  - `syscond-operator` → `keyword`
  - `syscond-literal` → `keyword`
  - `syscond-punct` → `delimiter`
- `src/webview/monaco/setup.ts` defines the fixed Dark+/Light+ palette; `variable` is
  `#9CDCFE`/`#001080`, `keyword` is `#569CD6`/`#0000FF`.
- The Document tree renders `appendConditionTokens` spans. The `.syscond-*` color rules live in
  `src/webview/components/documentTree/documentTree.css`, which is imported by
  `documentTreeView.ts` (the legacy page) but not by `editorMonaco.ts`.
- `editorMonaco.ts` renders Details `Condition`/`Conditions` with the same `appendConditionTokens`
  classes, so those spans currently have no matching color in the Monaco page.
- The Conditions panel renders plain `.condition-name-text`/`.condition-value-text`/
  `.condition-state` spans; it has no syscond token classes.
- `src/webview/styles/tokens.css` is imported by both `editorMonaco.ts` and `editorViewer.ts`
  and defines `--tok-*` variables from `--vscode-*` properties.

## 2. Palette

| Token | Dark | Light | Source |
|---|---|---|---|
| syscond name/reference | `#569CD6` | `#0000FF` | Dark+/Light+ preprocessor |
| operator | `#C586C0` | `#AF00DB` | Dark+/Light+ parameter/control-flow |
| literal (`true`/`false`) | `#4FC1FF` | `#0070C1` | Dark+/Light+ constant/enum |
| number | `#B5CEA8` | `#098658` | existing |
| string | `#CE9178` | `#A31515` | existing |
| punctuation | `#808080` | theme foreground | existing |

High contrast uses the nearest high-contrast base (`hc` → dark, `hc-light` → light) and the same
rules; the existing theme `base` already handles this (`hc-black`/`hc-light`).

## 3. Monaco tokens

- Extend `EcucTokenType` with `syscond` and `constant` (or map literals to an existing `constant`
  type if one exists; verify before adding).
- `CONDITION_TYPES`:
  - `syscond-name` → `syscond`
  - `syscond-operator` → `parameter` (already `#C586C0`/`#AF00DB`)
  - `syscond-literal` → `constant` (new rule `#4FC1FF`/`#0070C1`)
  - number/string/punct unchanged.
- `themeRules()`:
  - add `{ token: 'syscond', foreground: '569cd6' }` dark and `'0000ff'` light;
  - add `{ token: 'constant', foreground: '4fc1ff' }` dark and `'0070c1'` light;
  - `parameter` already provides the operator magenta.
- The `tokenizeEcucLine` tests assert the scopes for each syscond class.

## 4. Shared CSS

- Add semantic variables in `src/webview/styles/tokens.css`:
  ```css
  --tok-syscond: var(--vscode-debugTokenExpression-boolean, #569cd6);
  --tok-syscond-op: var(--vscode-terminal-ansiMagenta, #c586c0);
  --tok-syscond-literal: var(--vscode-terminal-ansiCyan, #4fc1ff);
  ```
  The fallbacks are the Dark+ values; the light theme supplies its own VS Code variables.
- Add the shared classes in `tokens.css`:
  ```css
  .syscond-name { color: var(--tok-syscond); }
  .syscond-operator { color: var(--tok-syscond-op); }
  .syscond-literal { color: var(--tok-syscond-literal); }
  .syscond-number { color: var(--tok-number); }
  .syscond-string { color: var(--tok-string); }
  .syscond-punct { color: var(--tok-punct); }
  ```
- Remove the duplicate `.syscond-*` color rules from `documentTree.css`; leave the `.condition`
  chip layout/state rules there. Set the tree `.condition` text/chip color to
  `var(--tok-syscond)` so the brackets and label share the macro color while token spans keep
  their own colors.
- The Details `.condition-code` already uses the shared classes; no page-specific rule needed.
- Conditions panel:
  - `.condition-name-text`/`.condition-name` → `var(--tok-syscond)`;
  - `.condition-value-text` → `var(--tok-syscond-literal)` for true/false, otherwise
    `--vscode-editor-foreground`;
  - `.condition-state` keeps its border and uses `--tok-syscond-literal`/`--tok-syscond-op` for
    the state text, not color alone.
  - Inputs keep readable foreground; if a token color is applied to an input, ensure focus and
    selection contrast.
- Both pages already import `tokens.css`; verify the legacy page and the Monaco page cascade.
- Add a small CSS assertion/test that `documentTree.css` no longer owns the syscond colors and
  that `tokens.css` defines them.

## 5. Preview

- Add an `editor-syscond` preview state: mount the syntax document, select the `Condition` row
  (the one with `SW-SYSCOND`), so Details shows the `Condition` code; optionally open the
  Conditions tab.
- Add the new preview theme variables to `src/test/preview/previewData.ts`:
  `--vscode-debugTokenExpression-boolean`, `--vscode-terminal-ansiMagenta`,
  `--vscode-terminal-ansiCyan` with the Dark+ values, so the screenshot shows the palette.
- Audit:
  - the Details `Condition` code contains `.syscond-name`, `.syscond-operator` and
    `.syscond-literal` spans;
  - the tree condition chip contains the same token classes;
  - the state is visible and no `.condition-code` span is unstyled.
- Add a screenshot and docs entry.

## 6. Compatibility and rollout

- No protocol, host or data-model change. CSS and token mapping only.
- The legacy page and the Monaco page share the same token classes and CSS variables.
- Rollback: revert `tokens.ts`, `setup.ts`, `tokens.css`, `documentTree.css`, Conditions panel
  CSS and the preview state. No persisted change.

## 7. Risks / decisions

- VS Code themes may not define `debugTokenExpression-boolean` or terminal ANSI variables; the
  fixed fallbacks keep the intended palette.
- The Conditions panel is a name/value editor, not a syscond expression; applying the full
  lexical palette there may over-color. Limit it to the condition name and state, not the input
  chrome.
- The diff view uses its own token provider; verify whether it consumes the same `tokens.ts`.
  If not, note it as a limitation rather than duplicating the palette.
