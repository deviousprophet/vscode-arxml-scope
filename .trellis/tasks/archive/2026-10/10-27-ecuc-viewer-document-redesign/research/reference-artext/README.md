# Reference ARTEXT capture

This is the **reference output** used to judge the viewer redesign, not the product. It was produced
from the remote branch `ref/ecucvalues-for-vscode` (SHA `134a2937`) and the synthetic
`D:\workspace\sample\display-rules.arxml`.

## Generation

```text
src/Arxml2Artext/Arxml2Artext.cmd <in.arxml> <out.artext>
```

The command runs `mmx -M Arxml2Artext.mm -S in -T out -A "sort all except ..."`.
The extension then applies `postProcessArtextGen`:

```ts
content = content.replace(/\[([\s\S]*?)\]/g, (_, i) => `[${i.replace(/\s+/g, '')}]`);
```

The raw `mmx` line was `[(A == B)]`; the post-processed line is `[(A==B)]`. The annotation
`/* [Note] module note */` and `<Crit1 == 1 && Crit2 == 2>` are unchanged.

## What the reference looks like

- A compact **monospace document**, one entity per line, 4-space indentation, `{`/`}` around children.
- No chips, cards, per-row borders, fixed label columns or second metadata line.
- The token scopes come from `syntaxes/artext.tmLanguage.json`:
  `keyword.control.artext` (schema/package/module/context), `string.quoted.double`,
  `constant.numeric`/`constant.numeric.hex`, `constant.language.boolean`,
  `entity.name.function` (dotted paths), `entity.name.type` (a label before a short name),
  `variable.other` (a name before `=` or an operator), comments, and the variant annotation.
- `display-rules-highlighted.html` is a research mock that applies those scopes with VS Code Dark+
  token colours. It is not the custom viewer; it shows the look being compared.

## Files

| File | Purpose |
|---|---|
| `display-rules.artext` | post-processed reference output |
| `display-rules-highlighted.html` | scoped/colour mock of the reference |
| `render-artext-preview.js` | throwaway generator for the HTML mock |
