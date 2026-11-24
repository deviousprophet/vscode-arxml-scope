# Design — diff body visual proof

## 1. Problem

The existing preview audit checks geometry of the old DOM and a few semantic cases. A screenshot
can look plausible while the body is wrong: the wrong model, stale classes, a stale bundle, a
placeholder fill, or a capture of the toolbar instead of the body. The proof child must inspect the
real Monaco models and the rendered body, and compare the body chrome to a checked-in reference.

## 2. Fixed reference state

Add `diff-body-reference` to `src/test/preview/previewData.ts`:

- a small deterministic `DiffDocument` with:
  - unchanged context rows,
  - changed numeric/text/boolean values and a word-level change,
  - added and removed containers/modules,
  - a renamed container/module pair,
  - one-sided rows with blank placeholders,
  - a condition-bearing row.
- Show diff + Context, merge mode on.
- The same state is used for the reference capture and the audit; no local sample files.

## 3. Reference capture/spec

Check in:

```text
docs/reference/diff-body/
  vscode-dark.png
  vscode-light.png
  vscode-hc.png        # smoke
  spec.json            # measured metrics + color roles + tolerances
  README.md            # capture procedure, VS Code version, theme, font/zoom
```

Capture procedure:

1. Use the shipped VS Code `^1.125` with the default Dark+/Light+/HC themes and the repo's editor
   settings.
2. Open a small text pair with the same chrome settings (or the ECUC semantic fixture rendered as
   plain text if needed) and show the diff body with unchanged regions visible and hidden.
3. Capture the body only (not the activity bar/sidebar), at a fixed width/zoom.
4. Record the measured values in `spec.json`; do not rely on the PNG alone.
5. State in `README.md` that the reference is for the diff body **chrome** (gutter, margin,
   density, colors, unchanged widget, ruler), not for the ECUC semantic content.

The reference image is documentation/test evidence; no VS Code source is copied.

## 4. Audit data

Add a `diffBodyAudit()` to `previewAudit.ts` returning:

```ts
interface DiffBodyAudit {
  models: { original: string[]; modified: string[] };
  gutter: { lineNumberWidth: number; signClasses: ...; owningSigns: ... };
  margin: { copyArrows: { side, line, className, rect }[]; duplicateRevert: boolean };
  lineFills: { side, line, className, color }[];
  wordSpans: { side, line, text, color, rect }[];
  unchanged: { visible: boolean; widgets: { label, rect, expanded }[] };
  ruler: { lane, color, position }[];
  navigation: { targets: string[]; current: string | undefined };
  density: { fontFamily, fontSize, lineHeight, gutterWidth, indent };
}
```

The audit runs against the **real** page (Monaco models + DOM + computed styles), not a copied
fixture. It must return an explicit failure if the editor/model/dom is unavailable.

## 5. Assertions / tolerances

- Gutter/margin: signs/arrows exist only on owning sides; copy arrows in the merge margin; no
  separate revert icon in merge mode; geometry within ±2 CSS px of the reference spec.
- Line/word fills: use VS Code diff color roles; placeholder lines have no fill; word spans are
  non-empty and inside changed lines.
- Unchanged: native widget geometry/labels/context and Show all behavior; no placeholder hidden as
  real context.
- Ruler: Monaco's native `.diffOverview`; no semantic marks or placeholders.
- Navigation: semantic changed/added/removed targets in order under swap; ends handled.
- Density: font/line height/gutter/indent within the documented tolerance.
- Negative controls:
  - hide the body layer,
  - remove the +/−/margin-arrow class,
  - paint a placeholder,
  - show a duplicate revert icon,
  - restore the custom center overlay,
  - add a semantic ruler decoration,
  - make the model unavailable.
  Each must fail with a specific message.

## 6. Preview integration

- `shotWebview` captures `diff-body-reference` in Dark+/Light+ and HC smoke.
- The audit writes `artifacts/webview/diff-body-reference.audit.json` and fails the state on any
  violation.
- `docs/WEBVIEW_PREVIEW.md` documents the reference image/spec, the chrome-vs-content caveat, and
  the negative-control list.
- The audit must not be satisfied by a toolbar-only or empty-body capture.

## 7. Risks / rollback

- Pixel comparison is brittle across fonts/zoom; use measured geometry/colors + a human reference
  image, with explicit tolerances, not raw image diff.
- Monaco internal DOM/classes can change; the audit should fail loudly, not silently pass.
- Rollback: remove the reference files, the state and the audit; the body implementation remains.
