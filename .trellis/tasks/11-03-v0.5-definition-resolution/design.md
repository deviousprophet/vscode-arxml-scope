# Design: ECUC definition resolution

## Data flow

```
module definition file (.arxml BSWMD/ECUC-MODULE-DEF)
  -> xmlStream + indexBuilder -> IndexDefinition[] in WorkspaceIndex
selected ECUC row (EcucRow.definitionRef)
  -> WorkspaceIndex.definition(ref) -> DefinitionInfo | undefined
  -> buildRows option -> EcucRow.definition -> inspectorFields -> Details rows
```

The workspace index owns definition records; the resolver is a pure function over the index. The
provider supplies a `DefinitionLookup` function to `buildRows`.

## Types

```ts
// src/core/index/definitions.ts
export interface DefinitionInfo {
  kind: string;                 // element tag, e.g. 'ECUC-INTEGER-PARAM-DEF'
  type: string;                 // normalized, e.g. 'Integer'
  range?: string;               // '0 .. 65535', '1 .. 32 chars'
  defaultValue?: string;
  lowerMultiplicity?: number;
  upperMultiplicity?: number;   // -1 is unbounded
  destination?: string;
  literals?: string[];
  description?: string;
  file: string;
}

export type DefinitionLookup = (definitionRef: string) => DefinitionInfo | undefined;
```

`EcucRow.definition?: DefinitionInfo` is optional. No range offsets travel on a row.

## Normalization

| Definition tag | Type | Range source | Multiplicity |
|---|---|---|---|
| `ECUC-INTEGER-PARAM-DEF` | Integer | `LOWER-LIMIT` .. `UPPER-LIMIT` | n/a |
| `ECUC-FLOAT-PARAM-DEF` | Float | `MIN` .. `MAX` | n/a |
| `ECUC-STRING-PARAM-DEF` | String | `MIN-LENGTH` .. `MAX-LENGTH` (chars) | n/a |
| `ECUC-BOOLEAN-PARAM-DEF` | Boolean | n/a | n/a |
| `ECUC-ENUMERATION-PARAM-DEF` | Enumeration | literals | n/a |
| `ECUC-FUNCTION-NAME-DEF` | Function name | n/a | n/a |
| `ECUC-LINKER-SYMBOL-DEF` | Linker symbol | n/a | n/a |
| `ECUC-PARAM-CONF-CONTAINER-DEF` | Container | n/a | `LOWER-MULTIPLICITY`..`UPPER-MULTIPLICITY` |
| `ECUC-MODULE-DEF` | Module | n/a | same |
| `ECUC-REFERENCE-DEF` / `ECUC-INSTANCE-REFERENCE-DEF` | Reference | n/a | same + `DESTINATION-REF` |

Unknown tags fall back to a humanized tag name rather than being dropped. `upperMultiplicity` is
`-1` for `*`/`UNBOUNDED`, otherwise the parsed integer.

Multiplicity display: `1..1` -> `1`, `0..1` -> `0..1`, `0..*` -> `0..*`.

Range display joins only the present endpoints with ` .. `; a single endpoint reads `>= x` or
`<= y`; string lengths append ` chars`.

## Resolution

```ts
export function resolveDefinition(index: DefinitionLookupIndex, ref: string): IndexDefinition | undefined;
```

Segments of `ref` split on `/`. Exact key first. Then for each shorter suffix, collect matching
definition paths; one match resolves, more than one returns `undefined`. This mirrors
`src/core/ecuc/resolve.ts` and intentionally refuses to guess.

## Details UI

`inspectorFields(row)` gains `definition?: DefinitionInfo`. `updateInspector` appends the definition
rows after the existing value/context/condition rows and before the action buttons. Values are
rendered as text rows through the existing `inspectorRow` helper, so no markup is introduced.

## Refresh

`EcucEditorProvider` subscribes to `IndexService.onDidChange` and calls the existing `push()` for
each open panel. `push` already reads the selected id and re-builds rows; only the row payload changes.

## Rollback

Remove the `definition` field, the details projection and the provider subscription. Indexing and
the status bar keep working; no user file is affected.
