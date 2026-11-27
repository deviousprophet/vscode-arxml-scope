# webview-preview spike (throwaway)

This directory is a **spike fixture**, not a shipped package. It exists to prove or
disprove the architecture decision recorded in
`.agents/skills/ux-review/references/WEBVIEW_PREVIEW_STACK.md` (the task record behind it is archived
separately):

- a generic Playwright core that consumes built webview assets;
- a small per-extension adapter (build command, entry, states, audits);
- an optional extension-host experiment that reuses the official VS Code test tooling.

Nothing here is imported by `src/` or by the shipped extension. Delete the directory
once the follow-up implementation task has its own home.

## Run

```bash
npm --prefix packages/webview-preview install
npm --prefix packages/webview-preview run preview:toy
npm --prefix packages/webview-preview run build:arxml
npm --prefix packages/webview-preview run preview:arxml -- --state diff-merge
```

The core uses the installed Chrome/Edge through Playwright (`PLAYWRIGHT_CHROME_PATH`
overrides detection); it never downloads a browser bundle.

## Evidence

The comparison matrix and recommendation live in
`.agents/skills/ux-review/references/WEBVIEW_PREVIEW_STACK.md` (written by the spike).
