# Spike scaffolding (throwaway)

De-risking scaffolding for Step 0 of `.trellis/tasks/10-14-ecuc-artext-editor/implement.md`.
It is **not** a deliverable and is deleted once both spikes are answered.

- `src/spikes/spikeProvider.ts` — a deliberately crude `CustomTextEditorProvider` whose "edit"
  replaces the whole file. That is the smallest thing that produces a dirty document and an
  invertible change, which is all the spikes need. It must never be copied into `src/editor/`: the
  real design writes only a `<VALUE>` element (parent D1).
- `sample.spike.arxml` — a synthetic file to open. The selector is `*.spike.arxml`, so this editor
  can never claim a real `.arxml`.

Procedure and the slots to record the outcomes: `.trellis/tasks/10-14-ecuc-artext-editor/research/spike-results.md`.
