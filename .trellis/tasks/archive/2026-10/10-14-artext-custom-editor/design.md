# Design: ARTEXT custom editor for ECUC-Values arxml

Implements `../10-14-ecuc-artext-editor/design.md` §6 (display rules), §9 (editor) and §10
(navigation), plus §11 (contributions). Read those first; this file records only what is specific to
this child and what it must decide itself.

## 1. Provider lifecycle

`resolveCustomTextEditor(document, panel, token)` runs once per panel, not once per file:

1. **Gate.** Check `.arxml`, then run the core detection. On failure, post an explanation, then
   `vscode.openWith(uri, 'default')` back to the text editor. The return must happen **before** any
   HTML is rendered, so a rejected file never flashes an empty tree. (`workbench.action.reopenWithEditor`
   stood here in the first draft and is wrong: it opens the *Reopen With…* picker rather than the text
   editor, so the fallback would not be deterministic. Corrected at implementation time — see
   `implement.md` §Outcome 2 — and the same call is what §2.3 already uses.)
2. **Scan.** `scanEcucValues(document.getText())` and keep the resulting model together with the
   `LineIndex`, in a per-panel state object.
3. **Render.** Build the HTML string with `renderHtml(model)` and set `panel.webview.html`.
4. **Wire.** `onDidReceiveMessage` for `reveal` and `follow` (§2.2); a
   `workspace.onDidChangeTextDocument` subscription filtered to this document; `panel.onDidDispose`
   to dispose both.

The re-scan subscription is not optional. Without it an external edit — or an undo of this editor's
own write in the sibling child — leaves a stale tree on screen, and the ranges it holds no longer
point at the right bytes.

## 2. Decisions this child owns

**2.1 View type and activation.** `viewType` is `vscode-arxml-scope.ecucEditor`, with
`selector: [{ filenamePattern: '*.arxml' }]` and **`priority: "option"`**.

The `priority` is not decoration and the first draft of this section was wrong about it: the manifest
default is `"default"`, which makes the custom editor the default for every matching file and would
break D14 and AC3. `"option"` is what actually keeps the text editor as the default and exposes the
custom editor only through *Open With…* and our own command. Verified in the manifest and asserted by
a test.

The supported entry point remains the command `vscode-arxml-scope.openEcucEditor`, which gates on
detection and then calls `vscode.openWith(uri, viewType)`.

**2.2 Message protocol.** Webview → extension: `{ type: 'reveal', nodeId }` and
`{ type: 'follow', nodeId }` (a reference's own range versus its target — one message cannot mean
both, so `follow` is separate). Extension → webview: `{ type: 'model', tree, selectedId }` after a
re-scan, `{ type: 'select', nodeId }` when the panel already exists, and
`{ type: 'notice', message, kind }` for an unresolvable reference. `nodeId` is a stable path-based id
from the model, not an array index, so it survives a re-scan that reorders nodes.

There is deliberately **no `ready` and no `filter` message**, as built: the initial model is baked
into the HTML, the filter is client-side (§2.5), and either round-trip would be a second, partial
update path — the bug source §3 warns about.

**2.3 Reveal, editor → source.** Open the same resource with the text editor at the node's range:
`vscode.openWith(uri, 'default', { selection })` followed by `revealRange`. Per Spike B, on a
resource already shown in the custom editor this **swaps** the editor rather than opening a second
pane; that is the accepted behaviour, and the outcome is recorded in the parent plan before this child
is implemented. If Spike B proved a live pair achievable, the same command targets the other group
instead and nothing else changes.

**2.4 Reveal, source → editor.** Offered from the arxml text editor. The cursor offset is converted
through `LineIndex` and matched against node ranges. Several nodes can contain one offset (a parameter
inside a container inside a module), so the **innermost** — smallest containing range — wins. This is
a binary search over ranges sorted by start offset, so the deep-nesting case stays cheap. The resulting
`nodeId` is passed through the same `reveal` handling as §2.3 in reverse, so both directions share one
mapping and cannot drift.

**2.5 Filter is client-side.** The input box narrows the already-rendered tree by matching label,
short-name and value, and keeps a node visible when any descendant matches. No message round-trip, no
re-scan: the filter is a view concern and the extension host already sent everything the view needs.

**2.6 Rendering.** `renderHtml` emits one inlined CSS block, one inlined script, a `nonce` on the
script tag and a CSP meta allowing only that nonce. Every colour is a `--vscode-*` variable
(parent R16). The tree uses real ARIA tree roles with `tabindex`, arrow-key traversal and visible
focus. A numeric value's hex form is a secondary element, not concatenated into the value, so the
edit child can replace the value text without touching it.

**2.7 Hover shows the full path.** The `DEFINITION-REF` path is already in the model; it goes in the
node's `title`, so no tooltip infrastructure is needed (parent D8).

## 3. Risks

- **Stale ranges.** Every path that mutates the document must re-scan. The subscription in §1 is the
  single mechanism; a second, partial update path would be the bug source.
- **Empty view on a rejected file** (§1.1) — the gate must complete before `webview.html` is set.
- **Live pairing** (§2.3) is settled by Spike B, not by assumption.
- **Large trees** (parent `design.md` §15.5): the tree is rendered whole. Measure with a realistically
  large file before adding virtualisation; do not add it speculatively.
