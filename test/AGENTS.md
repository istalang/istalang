# test

Inputs that tests across phases share. Unit tests live beside their code (`src/**/*.test.ts`).

- `corpus/spec-examples.ts`: the spec's fenced examples, read from `docs/spec.md` when tests load. An example is `elided` when it contains `…` placeholders; its fence's info string says when it isn't a whole module (` ```python statements`, ` ```python fragment`).
- `soup.ts`: random sequences of given fragments, for totality properties.
- `broken.ts`: valid texts with lines or tokens deleted, duplicated or swapped, for totality properties.
- `cyclic-programs.ts`: programs closing a cycle through a disposable at run time, each across one language construct, which static lifetimes must reject (`lifetimes-oracle.sweep.test.ts`).
- `definitions/`: hand-written Definitions (the M2.4 subset program, spec §12.3), so runtime tests can run without the compiler. `fixture-kit.ts` keeps them short and finds spans in each fixture's own source.
- Hand-written `.ista` cases, valid and invalid, go under `corpus/`. Never copy spec text there.
- `golden/`: what every program, suite and host scenario showed on the interpreter before the IR-first rewrite, which every pipeline is held to (`golden/golden.md`).
- `spec-suites/`: hand-written test modules for spec examples whose tests the spec elides, each run by an end-to-end test against the spec's own example code, written beside it at run time.

Principles:
 - Test commutation across transformations. Where the pipeline transforms a representation (generic → instantiated, fresh → incremental, in-memory → persisted), assert the commute law as a property: transforming then running must agree with substituting first and running directly, including degenerate inputs that collapse cases into one.
