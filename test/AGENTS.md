# test

Inputs that tests across phases share. Unit tests live beside their code (`src/**/*.test.ts`).

- `corpus/spec-examples.ts`: the spec's fenced examples, read from `docs/spec.md` when tests load. An example is `elided` when it contains `…` placeholders; its fence's info string says when it isn't a whole module (` ```python statements`, ` ```python fragment`).
- `soup.ts`: random sequences of given fragments, for totality properties.
- Hand-written `.ista` cases, valid and invalid, go under `corpus/`. Never copy spec text there.
