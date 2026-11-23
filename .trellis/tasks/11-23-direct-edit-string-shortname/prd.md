# Fix direct string and short-name typing corruption

## Goal

Typing directly into a textual parameter value or a container short name must behave like
normal text editing: only the intended field changes, quotes are preserved exactly, short
names are not truncated, and no stale-node error interrupts typing.

The user has approved the **Ctrl+S-only commit model**: typing, deleting and renaming stay
local until the user presses Ctrl+S. Enter and blur must not write to the host.

## Requirements

- Reproduce the reported symptom with a tight, deterministic feedback loop:
  - a textual parameter `Note = "generated performance row 1"` edited at the end must not
    become a run of extra quotes;
  - a container `BranchX "BranchX"` renamed to `BranchX123456` must keep the whole tail and
    must not report "the node is no longer in the file".
- Confirm the root cause with evidence; do not patch symptoms.
- Preserve one draft/one source for direct and Details edits.
- Keep every keystroke local. No host `edit` message may be posted while the user types,
  deletes, backspaces, deletes by word, cuts, pastes or replaces a selection.
- Ctrl+S is the only commit trigger:
  - flush one coalesced edit per changed field,
  - wait for every acknowledgement,
  - refuse to save while any field is invalid or refused.
- Enter in Details remains a no-op; blur and page hide must not commit. Closing with unsaved
  changes may warn, but must not write.
- Local drafts must survive a selection change. Editing field A, selecting another row, editing
  field B and pressing Ctrl+S must save both.
- Details inputs must keep focus and caret while the editor and the host update. Rebuilding the
  inspector must not drop the user out of the input.
- Cover every editable data type and every normal edit operation:
  - Integer, Float, Boolean, textual values, container short names and definition refs;
  - typing at the start/middle/end, backspace, Delete, Ctrl+Backspace/Ctrl+Delete, cut/paste,
    selecting part of the value and replacing it, and clearing the value.
- Invalid intermediate values (for example `-`, `0x`, `tru`) stay visible, are marked invalid,
  never reach the host, and block Ctrl+S until corrected.
- A container short-name rename must send only the final value, keep the node selected and
  never produce a stale-node refusal.
- Preserve the dirty marker, local error strip, Monaco markers, Escape restore and the existing
  host edit/save protocol.

## Acceptance Criteria

- [x] A recorded loop reproduces the original quote corruption and the Details focus loss.
- [x] The loop is minimised to the smallest typing sequence that still fails.
- [x] Root cause is identified with browser evidence and history, not speculation.
- [x] User confirms the root cause and the commit model (A, Ctrl+S only).
- [x] Typing/backspace/Delete/word-delete/replace posts no `edit` message before Ctrl+S.
- [x] After the fix, typing the full textual value leaves exactly one pair of quotes.
- [x] A full Details editing session keeps focus and caret; the next keystroke is never lost.
- [x] Typing the full short name keeps all trailing characters, keeps the node selected, and
      never reports a stale-node error.
- [x] Multiple drafts across rows save together on one Ctrl+S.
- [x] Nested short-name renames apply deepest-first and do not invalidate each other.
- [x] Invalid intermediate values stay editable and block Ctrl+S; correcting unblocks it.
- [x] Full suite, preview audit and production bundle pass after the fix.

## Notes

- This is a P0 follow-up on PR #40's branch.
- The details/editor draft is shared; the bug appears with direct keystrokes because the shared
  draft used to write to the host on a 160 ms debounce and treat every echo as a full document
  replacement.
- The user explicitly wants Ctrl+S, not Enter, as the save command.
