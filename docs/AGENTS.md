# docs

- `spec.md`: the language specification, the source of truth for language behaviour. Its code examples are test inputs.
- `arch/`: architecture that outlives any one feature.
- `reuse/`: the index of reusable units, one-way rules and extension recipes, grouped by caller need (`src/AGENTS.md`).
- `work/`: per-feature plans and phase details, plus `tracker.md` for status and filed debt.

Every doc carries front-matter. Its `description` says what the doc covers and when to read it. Docs record only repo-specific knowledge, anchored to stable surfaces.
