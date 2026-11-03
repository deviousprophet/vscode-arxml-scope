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
| Definition resolution | [`synthetic-module-def.arxml`](synthetic-module-def.arxml) — type, range, default, multiplicity and description in **Details** |

### Module definition

[`synthetic-module-def.arxml`](synthetic-module-def.arxml) is the synthetic `ECUC-MODULE-DEF` for the
sample. Keep both files in the same folder and the workspace index resolves every
`DEFINITION-REF`: select `TimeoutSeconds` and **Details** adds the declared type, `0 .. 65535`,
default `30`, and the description.

The index lives in memory only. The status bar shows how many `.arxml` files it holds and updates
when a file is saved or deleted; click it to rebuild. `arxmlScope.index.maxFileSizeMB` (default 50)
skips files that are too large for the index.

### Try an edit and a diff

1. In the ECUC editor, select `TimeoutSeconds`, change its value in **Details** and press `Enter`.
2. Set it to `70000`: the Problems panel reports a value outside the definition's `0 .. 65535`.
3. Open the file in the plain text editor and use **Go to Definition** on a `DEFINITION-REF`, or
   **Find References** on `Sub`, to see the index-backed navigation.
4. Copy the file to `examples/synthetic-ecuc-edited.arxml` (or anywhere outside the repository) and
   change one value, a short name or a condition.
5. Right-click the original file and choose **ARXML Scope → Select as First File to Compare**, then
   right-click the edited copy and choose **Compare with First File**.

Remove any local copies when you are done; the repository only commits the original synthetic file.
