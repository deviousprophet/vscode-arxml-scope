# Design — variant-aware validation and split-copy handling

Status: planned. Target version: next patch after 0.7.0.

## 1. Boundary and data flow

```
ARXML text
  → XmlStreamParser events
  → IndexBuilder            (new: contentHash, syscond, withAuto)
  → FileIndex / WorkspaceIndex (unchanged except copiesFor)
  → validateWorkspace       (new predicates)
  → Diagnostic[]
```

No new layer, no new module, no host change. `src/core/**` stays dependency-free (no `vscode`
import, no new runtime dependency).

## 2. Data model (`src/core/index/indexModel.ts`)

All three fields are optional so hand-built fixtures and existing call sites keep compiling.

```ts
export interface IndexElement {
	// ...existing fields...
	/**
	 * FNV-1a over the element's normalized subtree (tags, attributes except UUID,
	 * and text of indexed tags). Only set for `module` and `container`.
	 */
	contentHash?: number;
	/** Normalized own `VARIATION-POINT/SW-SYSCOND` text, when present. */
	syscond?: string;
}

export interface IndexReference {
	// ...existing fields...
	syscond?: string;
}

export interface IndexDefinition {
	// ...existing fields...
	/** AUTOSAR `WITH-AUTO`: the configuration tool assigns this element. */
	withAuto?: boolean;
}
```

`contentHash` is a `number` (32-bit FNV-1a). Rationale: 4 bytes per container/module, no string
retention. A 32-bit collision within one duplicate group is ~2^-32; a collision only hides a real
duplicate, never invents one. Upgrade path if ever needed: store a second seed as
`contentHash2` or widen to a hex string.

## 3. Index building (`src/core/index/indexBuilder.ts`)

### 3.1 Hash primitive

```ts
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashText(hash: number, text: string): number {
	let value = hash >>> 0;
	for (let at = 0; at < text.length; at++) {
		value = Math.imul(value ^ text.charCodeAt(at), FNV_PRIME) >>> 0;
	}
	return value;
}
```

No allocation, no crypto import.

### 3.2 Frame

```ts
interface Frame {
	// ...existing fields...
	/** Structural hash of everything seen inside this frame so far. */
	hash: number;
	syscond?: string;
}
```

Seed in `open()` (attributes are available there and are not retained):

```ts
frame.hash = hashText(hashText(FNV_OFFSET, '<' + name), attributeSignature(attrs));
```

```ts
/** Sorted `key=value` pairs, `UUID` excluded: copies differ only by UUID. */
function attributeSignature(attrs: ReadonlyMap<string, string>): string {
	const parts: string[] = [];
	for (const key of [...attrs.keys()].sort()) {
		if (key === 'UUID') continue;
		parts.push(key + '=' + attrs.get(key));
	}
	return parts.join('\u0001');
}
```

`open` currently stores `attrs` only for `DEFINITION-REF` / `VALUE-REF` / `TARGET-REF` /
`DESTINATION-REF`; that stays. The hash is seeded for every frame, which is cheap and keeps the
structural stream unambiguous.

### 3.3 Folding

`finishFrame`:

- Text frames (`TEXT_TAGS`): decode once, fold into the parent, then attach.

```ts
if (TEXT_TAGS.has(frame.name)) {
	const text = decodeXml(frame.text).trim();
	const parent = ancestors[ancestors.length - 1];
	if (parent !== undefined && frame.name !== 'UUID') {
		parent.hash = hashText(parent.hash, '\u0001' + frame.name + '=' + normalizeSpace(text));
	}
	this.attachText(frame, text, ancestors);   // signature gains the decoded text
	return;
}
```

- Every other frame: after the existing handling, fold the closed child into its parent.

```ts
const parent = ancestors[ancestors.length - 1];
if (parent !== undefined) {
	parent.hash = hashText(parent.hash, '\u0002' + frame.hash.toString(36));
}
```

`normalizeSpace(text) = text.replace(/\s+/g, ' ')`. Indentation and line breaks cannot change a
hash; `UUID` child text and the `UUID` attribute cannot either.

This is an order-sensitive structural hash: tags, attributes and text are all mixed with
separators, so `<A></A><B></B>` and `<A><B></B></A>` differ.

### 3.4 `TEXT_TAGS` additions

Add `WITH-AUTO` and `SW-SYSCOND`.

### 3.5 `attachText` additions

```ts
case 'SW-SYSCOND': {
	// The guard belongs to the nearest value element, not to VARIATION-POINT.
	const owner = nearest(ancestors, (candidate) =>
		candidate.name === MODULE_VALUES ||
		candidate.name === CONTAINER_VALUE ||
		PARAMETER_VALUES.has(candidate.name) ||
		REFERENCE_VALUES.has(candidate.name)
	);
	if (owner !== undefined) {
		const guard = normalizeSpace(text);
		owner.syscond = owner.syscond === undefined ? guard : owner.syscond + ' && ' + guard;
	}
	return;
}
case 'WITH-AUTO': {
	const parent = ancestors[ancestors.length - 1];
	if (parent !== undefined && isDefinitionKind(parent.name)) {
		(parent.definition ??= {}).withAuto = /^true$/i.test(text);
	}
	return;
}
```

Multiple `SW-SYSCOND`s under one variation point are ANDed in document order, mirroring the
scanner's interpretation of a joined condition.

### 3.6 Records

- `pushElement`: `contentHash: frame.hash` for `module` and `container` only; `syscond` when set.
- Reference record in `finishFrame`: `syscond` when set.
- `pushDefinition`: `withAuto` arrives through the existing `...(frame.definition ?? {})` spread.

`attachText` currently decodes `frame.text` itself; change it to take the decoded `text` as a
parameter. Exactly one decode per text frame, so entity sequences such as `&amp;amp;` are not
decoded twice.

## 4. Duplicate rule (`src/core/validation/validate.ts`, currently L113–140)

After the sort and the `crossFile` early exit:

```ts
const sameIdentity = sorted.every(
	(element) => element.kind === first.kind && element.definitionRef === first.definitionRef
);
const hashes = new Set(sorted.map((element) => element.contentHash));
const identical = hashes.size < sorted.length;
const guards = new Set(sorted.map((element) => element.syscond ?? ''));
const allVariants = sorted.length > 1 && guards.size === sorted.length;

// Split copies: one identity, several files, different content → one merged element.
if (sameIdentity && fileCount > 1 && !identical) {
	continue;
}
// Variant alternatives: identical content but every copy has its own guard.
if (allVariants) {
	continue;
}
```

Then the existing diagnostic is emitted unchanged.

Behavioral matrix:

| copies | identity | content | guards | result |
|---|---|---|---|---|
| cross-file, split children | same | different | any | suppressed |
| cross-file, byte-identical | same | identical | same/none | reported (information) |
| cross-file, byte-identical, different guards | same | identical | distinct | suppressed |
| same file, different children | same | different | any | reported |
| any, different `DEFINITION-REF`/`kind` | different | any | any | reported |

`undefined` hashes all collapse into one set entry, so hand-built elements without a hash keep
the pre-fix "report" behavior.

## 5. Multiplicity rule (currently L157–211)

Group key is unchanged (it is already per file and per owning parent). Inside the group loop:

```ts
const count = group.elements.length + group.references.length;
const perGuard = new Map<string, number>();
for (const item of [...group.elements, ...group.references]) {
	const guard = item.syscond ?? '';
	perGuard.set(guard, (perGuard.get(guard) ?? 0) + 1);
}
const exceedsUpper =
	upper !== undefined && upper >= 0 && [...perGuard.values()].some((value) => value > upper);
const offender = exceedsUpper ? Math.max(...perGuard.values()) : count;
if (count < lower || exceedsUpper) {
	// message uses `offender` instead of `count`
}
```

- Lower bound uses the **total**, because alternatives collectively satisfy a minimum.
- Upper bound uses the **per-guard maximum**, because alternatives are mutually exclusive.
- Unguarded values share the `''` guard, so ordinary repetition still violates the upper bound.

No group key change means cross-file copies are still not summed.

## 6. Required-child rule (currently L254–307)

In the loop over `children`, extend the existing skip line:

```ts
if (
	lower <= 0 ||
	child.kind === 'ECUC-ADD-INFO-PARAM-DEF' ||
	child.defaultValue !== undefined ||
	child.withAuto === true
) {
	continue;
}
```

`withAuto === false` and an absent `WITH-AUTO` both keep reporting.

## 7. Reference resolution (`src/core/index/workspaceIndex.ts`, `copiesFor` L345–361)

Only the `local.length > 1` branch changes:

```ts
const local = candidates.filter((candidate) => candidate.file === sourceFile);
if (local.length > 1) {
	const ordered = sortCopies(local);
	return [...ordered, ...sortCopies(candidates.filter((candidate) => candidate.file !== sourceFile))];
}
```

`copiesOfOneIdentity` has already rejected mixed identities, so this branch only ever merges
same-`kind`, same-`definitionRef` copies. `element` stays `copies[0]`, i.e. the earliest local
copy, which is what the details/navigation callers already assume.

Different identity still returns `undefined` → `{ ok: false, reason: 'ambiguous' }`.

## 8. Rejected alternatives

1. **Suppress every cross-file duplicate.** Hides 53 byte-identical duplicate groups, which are
   real copy-paste defects. Rejected.
2. **Group duplicates by `(path, contentHash)` and report only buckets of ≥2.** Identical outcome
   for split/identical copies but silently drops same-path different-definition collisions.
   Rejected: identity collisions must stay visible.
3. **Compute child-set disjointness.** The index deliberately does not retain element text
   (`indexModel.ts` header, quality guidelines), and per-container child lists would cost far
   more memory than one hash. Content inequality already separates split copies from identical
   copies. Rejected.
4. **Count the lower bound per guard.** Creates false positives when a lower bound is satisfied
   collectively by alternatives. Rejected in favor of total-lower / per-guard-upper.
5. **Skip all children of a `WITH-AUTO` container.** Too broad: the vendor data marks the
   required child itself, and a container can mix automatic and manual children.
6. **Treat `POST-BUILD-VARIANT-VALUE` as optional.** 447 remaining hits in the reference project,
   but the semantics are different (post-build variants still need a value unless the variant is
   not built). Explicit non-goal; decide separately with vendor evidence.
7. **New setting such as `arxmlScope.validation.variantAware`.** The behavior is correct without
   opt-in, and R5 forbids new settings.

## 9. Budgets

Existing gates, unchanged:

| Benchmark | Limit |
|---|---|
| `index-benchmark` (200k+ elements) | 60 s, 1 GiB |
| `validation-benchmark` (10 files, ~40 MiB) | 5 s, 512 MiB |

Added cost per text frame: one linear FNV pass (the text is already decoded for the index) and
one `parent.hash` fold per closed frame. Added retained memory: 8 bytes per container/module
plus an interned guard string only where the source has one. Both are within the existing limits;
no threshold may be raised to make this change pass.

## 10. Portability and reproduction

- No test reads a customer file, a `C:\toolbase` path, `ecu.worx` or a reference project.
- To re-run the measurement on any machine:
  1. `npm run compile-tests`
  2. Run a throwaway Node script (not committed) that walks a local `.arxml` tree, excludes
     `**/_fwd/**`, `**/_out/**`, `**/_gen/**`, builds `FileIndex`es with `buildFileIndex`, loads
     them into `WorkspaceIndex`, and counts `validateWorkspace(index, DEFAULT_SEVERITIES, 'auto')`
     by `rule`.
  3. Compare against the pre-change tree with `git stash` on the same input.
- The expected counts in `prd.md` come from that method and are a sanity signal, not a gate.

## 11. Rollback

Single revertible commit. No persisted state, no migration, no schema. Old indexes are rebuilt on
activation; reverting the commit restores the old behavior with no cleanup.
