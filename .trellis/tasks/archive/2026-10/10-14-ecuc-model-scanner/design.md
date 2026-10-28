# Design: ECUC scanner and ARTEXT model (core)

Implements `../10-14-ecuc-artext-editor/design.md` §4 (contracts), §5 (scanner), §6 (ordering),
§7 (resolution) and §8 (validation). Read that document first; this file records only what is
specific to the scanner child and the decisions it has to settle itself.

## 1. Scanner shape

A hand-written lexer plus an element stack. No recursive descent, no DOM, one pass over the input.

**Lexer modes:** `text`, `tag`, `comment`, `cdata`, `pi`, `doctype`. Entering `comment`/`cdata`/`pi`/
`doctype` is decided by the two characters following `<`; anything else is a start, end or self-closing
tag. Attribute values are scanned with their own quote character so a `>` inside an attribute value
cannot terminate the tag.

**Element stack entries:** `{ name, start, capture }` where `name` has any namespace prefix stripped,
`start` is the offset of the element's `<`, and `capture` is the accumulating record for elements the
model cares about. A self-closing tag is pushed and immediately popped so the same close handling runs
for both forms.

**Text accumulation:** characters in `text` mode are appended to the innermost open element's record.
Each captured record keeps, per interesting child, the child's text **and** its raw range, so a write
can target the original bytes rather than a reconstructed string.

**Comment and PI handling.** `design.md` §5 requires them to be skipped; they must not contribute to
any element's text, and they must not shift ranges. A fixture asserts both.

## 2. Decisions this child owns

**2.1 `<VALUE>` disambiguation.** Resolved from the stack top, never from the tag name: a `VALUE` whose
nearest enclosing element is an `ECUC-NUMERICAL-PARAM-VALUE` or `ECUC-TEXTUAL-PARAM-VALUE` is a
parameter value; one whose nearest enclosing element is a `POST-BUILD-VARIANT-CONDITION` belongs to
that condition. One fixture contains both so the rule cannot regress into a name-only check.

**2.2 `pathIndex` key construction.** Keyed by the leading-slash, `/`-joined chain of enclosing
`SHORT-NAME`s, e.g. `/PkgA/PkgB/Container/Sub`.

**Settled during implementation.** The chain is the full AUTOSAR-style path: the `AR-PACKAGE` chain,
then the module `SHORT-NAME`, then the enclosing container `SHORT-NAME`s with the innermost last —
e.g. `/P/M/C1/C2`. It is produced as `containerPath` in the container branch of
`src/core/ecuc/scanner.ts`, and the same chain builds the `pathIndex` keys.

This was the one place where the reference analysis did not pin the behaviour down: an ECUC container
is a configuration value rather than an AUTOSAR object with its own `AR-PACKAGE` path, and the one
real `.artext` sample showed only definition paths, never a resolved in-file container reference.
Because the fallback in §2.3 is chain-agnostic, a shorter, customer-style reference still resolves
through longest-unique-suffix matching, so this choice cannot silently break resolution either way —
it only decides which references resolve *exactly*.

**2.3 Resolution.** Exact match on `targetRawPath` first; then longest-suffix match over the index
keys. An ambiguous suffix resolves to nothing — guessing would navigate to a wrong element, which is
worse than not navigating. The dotted `targetPath` is **never** used for resolution (parent D9); it is
display text only, and a short-name containing a `.` would make the reverse conversion ambiguous.

**2.4 Ordering.** Key is the tuple `(definitionRef, identity)`, identity being `shortName` for modules
and containers and the value for parameters and references; exception entries use `(definitionRef, '')`.
Equivalence with the legacy `DEFINITION-REF + '"' + identity + '"'` string key holds because `"` sorts
below every character legal in an AUTOSAR short-name or path — asserted by a test using a
`DEFINITION-REF` that is a prefix of another. `Array.prototype.sort` stability is relied on for the
exception-list declaration-order guarantee. Sorting is applied per list and never merges the parameter
and reference lists.

**2.5 Validation grammar.** Numerical parameters accept `true`/`false`, `-?\d+`, `0[xX][0-9A-Fa-f]+`,
and `-?\d+\.\d+([eE][+-]?\d+)?`. Textual parameters accept any string representable in XML 1.0.
Control characters other than tab, newline and carriage return are refused for both. Escaping on write
is `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`. An unchanged value is refused so that idling cannot dirty the
document.

**2.6 Ranges are UTF-16 code units.** The same unit VS Code uses for `Position`, so
`LineIndex.positionAt` is an offset lookup into a precomputed array of line-start offsets with a binary
search — no re-splitting of the text per conversion (the reference's `offsetToPosition` re-slices the
whole document on every call).

**2.7 No input retention.** The returned model holds only strings, numbers and ranges. The source
string is not referenced, so it can be released after scanning.

## 3. Risks

- **Deep nesting.** The reference's own CHANGELOG records a critical bug at 5+ container levels, so the
  fixture set includes six levels and the fixture's expected model is hand-authored.
- **Edge cases.** `<!DOCTYPE>` internal subsets, CDATA, entity decoding, and attribute values
  containing `>` are the likely defect sites; each has a fixture and an assertion.
- **`pathIndex` semantics** per §2.2 is the one place where behaviour is not fully pinned by the
  reference; it is written up as an open item rather than assumed.
