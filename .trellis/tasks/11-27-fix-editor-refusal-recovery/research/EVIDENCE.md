# Evidence — fix editor refusal and recovery feedback

Worktree: `H:\workspace\arxml-scope-worktrees\editor-refusal-recovery` (branch `fix/editor-refusal-recovery`).

## What changed

- One refusal surface per invalid field: inline Details error + compact toolbar state while Details
  is visible; top strip when Details is hidden. The Details status line no longer repeats it.
- Operation-aware copy: `Invalid value`, `Short name refused`, `Definition refused`, `Save blocked`.
- Numeric formats are recomputed from the draft; an unformattable draft renders
  `Numeric formats: last accepted value` instead of stale Decimal/Hexadecimal/Binary numbers.
- A stale draft (row gone after a re-scan) sets a page-level blocked state: persistent banner,
  blocked Details summary with no editable control, `Discard draft` and `Reload`. `Ctrl+S` stops on
  the dead draft without posting an edit/save and without looping.
- `reload` page→host message re-scans the document; no parallel protocol.

## Preview evidence (headless Chrome, 1400×900, DPR 1)

| State | Result | Evidence |
|---|---|---|
| `editor-invalid` | pass, 0 violations | `evidence/preview/editor-invalid.png`, `.audit.json` |
| `editor-rename-refusal` | pass, 0 violations | `evidence/preview/editor-rename-refusal.png`, `.audit.json` |
| `editor-stale-save` | pass, 0 violations | `evidence/preview/editor-stale-save.png`, `.audit.json` |
| `editor-stale-discard` | pass, 0 violations | `evidence/preview/editor-stale-discard.png`, `.audit.json` |

Also re-ran the valid-draft states with 0 violations: `editor-dirty`, `editor-details`,
`editor-details-save`, `editor-details-undo`, `editor-details-redo`, `editor-details-rename`,
`editor-rename-late-ack`, `editor-multi-save`.

Audit coverage added: `editor-invalid` asserts one inline surface, no strip/status duplicate, no
stale formats and the `last accepted value` label; `editor-rename-refusal` asserts the `Short name
refused` toolbar copy and no duplicate; `editor-stale-save` asserts the persistent banner, disabled
Details, recovery actions and no post; `editor-stale-discard` asserts discard clears the state and
the dirty marker.

## Host evidence (Extension Development Host)

Command: `UX_HOST_ONLY=stale-node,edit-invalid node .agents/skills/ux-review/scripts/host/run.mjs`

Result: `host-run.json` ok, both scenarios ok.

- `stale-node`: banner visible, toolbar `Save blocked — row removed`, no editable Details control,
  both actions present, no status duplicate, Discard clears the blocked draft.
  Screenshots: `evidence/host/edit-16-stale-*.png`, `edit-16-stale-discarded-*.png`.
- `edit-invalid`: one inline field error, strip/status empty, `Invalid value — not saved` toolbar,
  `Numeric formats | last accepted value`, blocked save, fix saves, dirty marker clears.
  Screenshots: `evidence/host/deep-edit-invalid*.png`.

## Commands

- `node esbuild.js` — pass
- `npm run check-types` — pass
- `npm run lint` — pass (0 errors/warnings; design info only)
- `npm test` — 947 passing, exit 0
- `npm run engine:smoke` — pass (`protocol:1`, `planned:1`, `diffOk:true`, `patchOk:true`)
- `npm run rust:test` — pass (all workspace suites, 0 failed)

## Known limits

- The preview harness seeds VS Code tokens; real theme fidelity is covered by the host screenshots.
- The host stale case renames the owning container, so the old path id cannot return. `Reload` is
  exercised as a message/action; `Discard` is the recovery proven end-to-end in both layers.
