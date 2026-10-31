# Examples

## Synthetic ECUC sample

[`synthetic-ecuc.arxml`](synthetic-ecuc.arxml) is a small, self-contained ECUC-Values file. It is
synthetic: it is not copied from a customer project and contains no real configuration.

### Open it

1. Open this repository folder in VS Code with the extension installed.
2. In the Explorer, right-click `examples/synthetic-ecuc.arxml` and choose
   **ARXML Scope → Open with ECUC Editor** (or **Open With… → ECUC Values Editor**).
3. Select rows and inspect **Details**; open **Conditions** and set `SAMPLE_ENABLED` to `true` or
   `false` to see the `Sub` subtree become enabled or dimmed.

A plain double-click opens the text editor, because the custom editor is opt-in.

### What it covers

| Case | Where |
|---|---|
| AR package and module | `/Synthetic`, `SampleModule` |
| Module variant | `VARIANT-PRE-COMPILE` |
| Container and sub-container | `Main` and `Sub` |
| Integer, Float, Boolean, String, Enumeration, Function name and Linker symbol parameters | `Main` parameter values |
| Same-file reference | `PeerRef` → `/Synthetic/SampleModule/Main/Sub` |
| Instance reference with context | `PeerIref` (`TARGET-REF` + `CONTEXT-ELEMENT-REF`) |
| Annotation | Module and `Main` container annotations |
| `SW-SYSCOND` | `Sub` variation point, `(SAMPLE_ENABLED == true)` |
| Empty container | `Empty` (shows `{ }`) |

### Try an edit and a diff

1. In the ECUC editor, select `TimeoutSeconds`, change its value in **Details** and press `Enter`.
2. Copy the file to `examples/synthetic-ecuc-edited.arxml` (or anywhere outside the repository) and
   change one value, a short name or a condition.
3. Right-click the original file and choose **ARXML Scope → Select as First File to Compare**, then
   right-click the edited copy and choose **Compare with First File**.

Remove any local copies when you are done; the repository only commits the original synthetic file.
