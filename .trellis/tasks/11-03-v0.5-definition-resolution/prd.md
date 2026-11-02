# v0.5: ECUC definition resolution

## Problem

The Details panel can show the `DEFINITION-REF` text, but not what the definition says. ECUC
engineers need the declared type, range, default, multiplicity and description without opening the
module definition file.

## Requirements

- **R1 — Definition lookup.** Given a `DEFINITION-REF` from an ECUC value, resolve it against indexed
  definition elements. Exact AR path wins; a unique path-suffix match may resolve; two or more suffix
  matches are ambiguous and resolve to nothing. Resolution is cross-file.
- **R2 — Definition metadata.** A resolved definition exposes: definition kind (normalized type),
  declared range or length, default value, lower/upper multiplicity, destination type for
  references, enumeration literals, description, and the source file.
- **R3 — Details projection.** A selected module, container, parameter or reference row carries an
  optional definition block. The panel shows only the fields the definition provides, in this order:
  `Definition type`, `Range`, `Default`, `Multiplicity`, `Values` (enum literals), `Destination`,
  `Definition description`, plus `Definition file` as the last row for cross-file provenance.
- **R4 — Never blocks the editor.** An absent, ambiguous or unreadable definition adds no rows and
  raises no warning; the existing `Definition` (path) row is unchanged.
- **R5 — Refresh.** Rows already open re-render when the workspace index changes, so a saved module
  definition file updates the Details without closing the editor.
- **R6 — Purity.** Resolution and normalization live in `src/core/index`, have no `vscode` import, and
  are unit-tested with synthetic fixtures.

## Acceptance criteria

- `resolveDefinition` returns the exact definition across a file boundary and refuses an ambiguous
  suffix.
- Normalization covers integer, float, boolean, string, enumeration, function-name, linker-symbol,
  container and reference definitions: type, range/length, default, multiplicity, destination and
  literals are each asserted.
- `buildRows` with a definition lookup adds the definition block only to rows whose definition
  resolves; without a lookup no row carries it.
- The Details projection includes every provided field once, in the documented order.
- An extension test opens the sample values file, reads the row payload, selects a parameter and
  confirms the definition text appears in the page. If driving the rendered page is not stable, the
  test asserts the provider payload instead and the page test asserts the projection.
- `npm run check-types`, `npm run lint` and `npm test` pass.

## Out of scope

- Editing from definitions, create-from-definition, validation and multiplicity diagnostics (v0.6+).
- Variant-specific definition merging; the first exact match wins and ties are ambiguous.
