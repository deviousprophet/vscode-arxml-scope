# Implement — Search on Enter, visible marks, console errors and icon Conditions actions

## Checklist

- [x] **1. Finish the Search state machine**
  - Keep `searchQuery` as the committed query; add/verify `executeSearch` and
    `resetSearchResults`.
  - Remove live search from the `input` listener; it only keeps the clear X in step and invalidates
    stale results.
  - Enter executes a changed query or cycles an executed one; Shift+Enter goes backwards.
  - `renderSearchUi` uses the input text only for the clear X; count/nav use the committed query.
- [x] **2. Fix match visibility**
  - Define `--match-bg` and `--match-hi` as the fixed dark-theme yellow tiers.
  - `mark` uses `--match-bg`; `[data-search-current="true"]` uses `--match-hi`.
  - Keep `color: inherit` and the forced-colors outline override.
  - Reproduce the rendered page in headless Chromium, type a query, press Enter and verify at least
    one `mark` exists with a non-transparent background.
- [x] **3. Remove the editor notice, keep console errors**
  - Delete `#notice` markup and `.notice` CSS from `renderHtml`.
  - Add `consoleErrorScript` to `pageError.ts`; emit it first with
    `ecucInstallConsoleErrors` / `ecucReportError` / `ECUC editor`.
  - Keep `pageErrorScript` and the diff page unchanged.
  - Update the notice handler comment: recoverable messages only go to Details/Conditions.
- [x] **4. Icon-only Conditions actions**
  - Build Save/Cancel with `conditionIconButton` and check/X SVG paths.
  - Keep `condition-save`/`condition-cancel` classes, titles and aria-labels.
  - Remove the text-button padding; keep Save/Cancel visible in edit mode.
  - Leave Edit/Remove, click delegation and keyboard handling unchanged.
- [x] **5. Tests and docs**
  - Update `render.test.ts` for console-only errors and no notice.
  - Update `uxDocument.test.ts` to assert no notice element and keep status routing.
  - Update `search.test.ts` for Enter-only execution and the fixed highlight tiers; add an
    `executeSearch` behavioural check.
  - Update `uxConditions.test.ts` for icon-only Save/Cancel.
  - Update spec docs, CHANGELOG and PR #12 wording; do not mention the reference product in the PR.
- [x] **6. Validate**
  - `npm run check-types`
  - `npm run lint`
  - `npm test`
  - `npm run package`
  - Headless Chromium probe for mark presence/background.
  - Extension Development Host manual pass remains unverified if no host is available.

## Validation commands

```powershell
npm run check-types
npm run lint
npm test
npm run package
```

## Review gates

- After steps 1-2: headless render must show `mark` count > 0 and `background-color` not transparent.
- After step 3: grep the editor page for `The ECUC editor page failed`, `id="notice"` and
  `ecucInstallErrorSurface`; all must be absent.
- After step 4: Conditions tests plus a visual check of the row action icons.
- Before commit: full suite and package.

## Result

- Automated gate: `check-types`, `lint`, `test` and `package` green.
- Headless Chromium: typing `Cont` produced 0 marks and no count; Enter produced 8 marks with the
  current row at `rgba(234, 179, 8, 0.7)` and every other mark at `rgba(234, 179, 8, 0.32)`, count
  `1 / 4`.
- Editor page: no `id="notice"`, no `ecucInstallErrorSurface`, no
  "The ECUC editor page failed"; console reporter is armed before `acquireVsCodeApi`.
- Conditions Save/Cancel are icon-only check/X actions with names; Edit/Remove keep the shared
  hover/focus icon affordance.
- Extension Development Host manual pass was not available here; record it as unverified.

## Rollback

- The search changes live in `renderHtml.ts`; restore the previous live-input listener to return to
  live search.
- The highlight tiers are two CSS variables and two rules.
- Console errors: restoring `#notice` + `pageErrorScript` is one block in `renderHtml.ts` and its
  import.
- Conditions actions: `renderConditionRow` Save/Cancel markup and two CSS rules.
