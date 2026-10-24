# test

Inputs that tests across phases share. Unit tests live beside their code (`src/**/*.test.ts`).

- `corpus/spec-examples.ts`: the spec's fenced examples, read from `docs/spec.md` when tests load. An example is `elided` when it contains `…` placeholders.
- Hand-written `.ista` cases, valid and invalid, go under `corpus/`. Never copy spec text there.
