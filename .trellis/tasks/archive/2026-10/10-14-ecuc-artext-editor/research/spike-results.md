# Step 0 spike procedure and results

Two questions from the parent `design.md` could invalidate large parts of the plan. The **API half of
Spike A answered itself** the moment the scaffolding was type-checked; what remains needs a human at a
running VS Code, because it depends on pressing Ctrl+Z and watching an indicator.

Scaffolding: `spike/` at the repository root, `src/spikes/spikeProvider.ts`. Throwaway; delete both
once the answers below are recorded.

## Spike A — answered from the API contract, behaviour still to confirm

**Finding (settled, no human needed).** `@types/vscode` is unambiguous:
`CustomTextEditorProvider` declares **only**

```ts
resolveCustomTextEditor(document: TextDocument, webviewPanel: WebviewPanel, token: CancellationToken): Thenable<void> | void;
```

There is no `openCustomDocument`, no `onDidChangeCustomDocument`, and no `saveCustomDocument` /
`saveCustomDocumentAs` / `revertCustomDocument` hook on it. Those belong to `CustomEditorProvider` —
the variant that owns a custom document of its own.

**Consequence for the design.** Because this provider edits the **real `TextDocument`**, undo, redo,
the dirty indicator and save are VS Code's own behaviour, obtained for free by writing through
`WorkspaceEdit`. The invertible `CustomDocumentEditEvent` machinery that `design.md` §9 originally
specified is **not needed and must not be built**; the first version of the scaffolding tried to
implement it and could not even type-check, which is how the mistake surfaced. Corrected in
`design.md` §9 and §15.2, and in the editing child's `design.md`.

What is genuinely left to confirm by hand is only that the behaviour matches that contract.

## How to run

1. `npm install`, then press **F5** (Run Extension) to open an Extension Development Host.
2. In the host window, open `spike/sample.spike.arxml`.
3. Run the command palette command **`Spike: Open lifecycle probe editor`** with that file focused.
   There is deliberately no menu entry and no default association: registering the `*.spike.arxml`
   selector alone must not claim anything.

Record what you actually observe, including "did not work". An unexpected result here is worth more
than a confirmation.

| # | Do this | Expected | Observed |
|---|---|---|---|
| A1 | Open `sample.spike.arxml` **normally**, before ever running the command | Opens in the **text** editor; the probe has not claimed `.arxml` | |
| A2 | Run `Spike: Open lifecycle probe editor` | The probe opens and shows the file text | |
| A3 | Edit the textarea, press **Apply** | The document becomes **dirty** (dot on the tab) | |
| A4 | Press **Ctrl+Z** | The previous content returns; the tab is clean again. **One press**, not two | |
| A5 | Press **Ctrl+Y** | The applied content returns | |
| A6 | Press **Ctrl+S** | Saved; the dot clears; the bytes are on disk | |
| A7 | Apply, then `File: Revert File` | Reloads from disk and the textarea refreshes | |
| A8 | Edit the file in a **text** editor while the probe is open | The textarea refreshes | |

**If A4 needs two presses, or A3 shows no dirty dot:** stop before Step 3 and report it. That would
mean the native text-document history is being double-counted by something in the write path, and it
must be understood before write-back is built on top.

## Spike B — can the custom editor and the text editor coexist for one file?

Settles `design.md` §10 and §15.1. It decides only whether R9 is delivered as **two commands**
(always possible) or as **live side-by-side synchronisation** (only if proven).

| # | Do this | Question being answered | Observed |
|---|---|---|---|
| B1 | With the probe open, use **Open With…** to open the *same* file with the **Text Editor** in a **second group** | Do both stay open, or does one replace the other? | |
| B2 | With both open, edit in the text editor | Does the probe update live? Does the text editor show the probe's next edit? | |
| B3 | With the probe open, run the command again | Focuses the existing probe, or opens a second one? | |
| B4 | From a text editor on the file, **Open With…** → the probe while the probe is open elsewhere | Same question as B1, from the other direction | |

**Consequence, decide from the observations:**

- **Live pair achievable** → `design.md` §10 may target the other group and reveal can stay live.
  Record the mechanism; the editor child will implement it.
- **Not achievable** (the likely outcome) → keep R9 as the two commands already described in §10:
  editor → source opens the file in the text editor at the node's range; source → editor maps the
  cursor to the innermost node and opens the editor there. That is a complete implementation of R9,
  not a degradation — record it as the decision and move on.

## Outcomes

_(fill in; this section is what the next session reads)_

- **Spike A:** API contract settled (no invertible-event machinery; undo/redo/dirty/save are native).
  Behavioural rows A1–A8: _not yet observed_.
- **Spike B:** _not yet observed_.
