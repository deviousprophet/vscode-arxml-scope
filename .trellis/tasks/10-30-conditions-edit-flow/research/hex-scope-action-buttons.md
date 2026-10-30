# Hex Scope action-button reference

Source: `D:\workspace\vscode-hex-scope` (read-only sibling extension). The relevant pattern is the
inline editor footer and the per-row actions in the sidebar overlay panel.

## Reference anchors

- `src/webview/components/sidebar/overlayPanel/overlayPanel.ts:733-734` — editor footer:
  `<button id="oe-save" class="sb-btn sb-btn-primary">Save</button>` followed by
  `<button id="oe-cancel" class="sb-btn sb-btn-secondary">Cancel</button>`.
- `overlayPanel.ts:990-991` — the shared editor tail repeats the same primary Save / secondary
  Cancel pair.
- `overlayPanel.ts:1761-1766` — `wireEditorSaveCancel` binds Save to `saveEditorDraft` and Cancel to
  the editor close/reset path.
- `overlayPanel.ts:3076-3078` — per-row actions:
  - `.act-btn-edit` pencil (`title="Edit" aria-label="Edit"`);
  - `.act-btn-view-type` secondary action;
  - `.act-btn-del` trash (`title="Delete" aria-label="Delete"`).

## What to adopt for ARXML Scope

- Edit is a small pencil icon action on the row.
- Save is a **primary** button; Cancel is a **secondary** button; both are visible only while the
  row is in edit mode.
- Remove is a small trash icon action, available only for manual rows (scanned constants are owned by
  the document).
- Drafts are explicit: type, then Save or Cancel; do not persist on every keystroke.
- The name of a derived/scanned item is not editable; only the value is.

## What not to copy

- Hex Scope's overlay/type-definition form is a full panel; the Conditions table needs a compact
  per-row form, not a full sidebar form.
- Hex Scope actions mutate its own `.hexscope` JSON store; ARXML Scope keeps the workspace-state
  contract and sends one `conditions` message per commit.
