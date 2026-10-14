# Legacy `Arxml2Artext` — vendored reference (text only)

Ground truth for the ARTEXT information model that `src/core/ecuc/` reimplements. Kept in the
repository so that work can continue on another machine without the Bosch-internal
`ecucvalues-for-vscode` checkout being present.

## Provenance

Copied verbatim on 2026-10-14 from `ecucvalues-for-vscode/src/Arxml2Artext/`:

| File | Size | What it is |
|---|---|---|
| `Arxml2Artext.mm` | 8 326 B | The `mmx` mapping script: defines the tag handling, the sort key and the output shape. The source of every rule implemented in the scanner. |
| `Arxml2Artext.cmd` | 437 B | The launcher. Carries the 15-entry `except` list that is the default of the `arxmlScope.ecuc.editor.sortExcept` setting. |

Both files are byte-identical to their originals.

## Deliberately not vendored

`bin/` and `plugins/` are **not** copied and must **not** be added: they are the Ovidius `mmx`
toolchain — roughly 13 MB across ~60 third-party binaries (`MMx.dll`, `com.ovidius.mm.*`,
`xerces-c_3_1.dll`, …) — and `bin/license.dat` is a license credential. This repository is public;
publishing either would mean redistributing licensed third-party software and leaking a license
file, and a force-push would not take it back. The extension does not use `mmx` and is not meant to.

The behaviour of those binaries was **observed and written down**, not redistributed: see
`.trellis/tasks/10-14-ecuc-artext-editor/research/legacy-artext-analysis.md`, which is the digest the
implementation works from.

## The invocation, for reference only

```
set PATH=%0\..\bin;%PATH%
mmx -M Arxml2Artext.mm -S in.arxml -T out.artext -A sort all except DcmDspDidRef,...
```

This is *not* how the extension works. It parses the arxml once, in process, and writes nothing.

## Use

Read the `.mm` to check a semantic claim about the model — the tag list, the sort key, what
`\structify` and `\indent` do. Do not build against it, do not add it to the extension bundle, and do
not restore `bin/`. For the reader-facing description of the feature, see
[`docs/ECUC_EDITOR.md`](../../docs/ECUC_EDITOR.md).
