# Component Spec Template — `<ComponentName>`

> **Naming rule:** every webview component lives at `src/webview/components/<ComponentName>/`
> (`<ComponentName>.ts`, optional render/paint layer, `<ComponentName>.css`). Every component spec
> lives at `.trellis/spec/frontend/components/component-<name>.md`. Copy this file, rename it, fill
> every section, and add it to the components index.

## Scope / Trigger

Owns `src/webview/components/<ComponentName>/`: the self-contained UI unit that owns its markup,
transient UI state, input behaviours and styles. The host composition root owns data, domain logic,
persistent state and provider messages.

Boundary rule: the component never reads or writes host globals, never calls feature/engine
functions, and never posts provider messages — it reports through callbacks the host wires.

## Layout

```text
src/webview/components/<ComponentName>/
    <ComponentName>.ts       types + render function(s) + interaction controller
    <ComponentName>.css      colocated styles, imported by the .ts
src/webview/<host>Viewer.ts  composition root: data, callbacks, state
src/test/webview/components/<component-name>.test.ts
```

Component tests are flat under `src/test/webview/components/`, mirroring the source component
directory.

## Contract

```typescript
interface <ComponentName>RenderInput { /* declarative paint state the host feeds */ }
interface <ComponentName>Callbacks { /* report-only; host decides */ }
export function render<ComponentName>Html(input: <ComponentName>RenderInput): string; // pure
export class <ComponentName> {
    constructor(rootSelector: string, cb?: <ComponentName>Callbacks);
    mount(): void;                       // idempotent, root-scoped
    setCallbacks(cb: <ComponentName>Callbacks): void;
    // host-invoked paint/scroll methods
}
```

## Rules

- Component holds only UI/transient state (hover, drag, display flags it owns). Persistent and
  domain state live in the host.
- Component reads no host global and writes no host global.
- Pure render functions are DOM-free and testable; every paint decision is an input.
- Interaction reports through callbacks; the component never mutates selection or domain state.
- Root-scoped constructor (`rootSelector`); no global DOM ids, so two instances coexist in the diff.
- Markup keeps the agreed classes/attributes; the host never writes component row DOM directly.
- Component CSS is colocated and imported by the component `.ts`; shared tokens/resets/layout stay
  in `src/webview/styles/`.
- Untrusted text is escaped by the shared escape helper.
- No size/layout math in TS when CSS can own it.

## Behaviour

- User-visible behaviour matrix and parity guarantees against the pre-refactor view.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| ... | ... |

## Tests Required

`src/test/webview/components/<component-name>.test.ts`: pure render, interaction reports, paint
methods, root scoping, and parity assertions for the existing page behaviour.

## Anti-patterns

- Component importing host state, engine functions, `vscode`, or the provider message API.
- Host writing component DOM directly instead of a `paint*` method.
- Global DOM-id queries inside the component.
- Size/layout math in TS instead of CSS.
- Diff-only behaviour added before the diff component owns it.
