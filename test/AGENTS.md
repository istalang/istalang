# test

Inputs that tests across phases share. Unit tests live beside their code (`src/**/*.test.ts`).

- `corpus/spec-examples.ts`: the spec's fenced examples, read from the chapters of `docs/spec/` when tests load. An example is `elided` when it contains `…` placeholders; its fence's info string says when it isn't a whole module (` ```ista statements`, ` ```ista fragment`).
- `soup.ts`: random sequences of given fragments, for totality properties.
- `broken.ts`: valid texts with lines or tokens deleted, duplicated or swapped, for totality properties.
- `cyclic-programs.ts`: programs closing a cycle through a disposable at run time, each across one language construct, which static lifetimes must reject (`lifetimes-soups.sweep.test.ts`).
- `subset.ts`: the M2.4 subset program and its outcome, which the checker's and `ista run`'s tests share.
- Hand-written `.ista` cases, valid and invalid, go under `corpus/`. Never copy spec text there.
- `golden/`: what every program, suite and host scenario showed on the interpreter before the IR-first rewrite, which every pipeline is held to (`golden/golden.md`).
- `suites/`: test modules by area of the run (awaitables, callbacks, waits, instances, aliasing, disposal, functions), holding the rules the old pipeline's unit tests asserted; the `suites` goldens run them.
- `slices.ts`: a sweep's slices, a test file each, so vitest runs a long sweep side by side: a slice `<sweep>-<n>.sweep.test.ts` calls the registering function of its sweep module (`*.sweep.ts`) with its `import.meta.url`.
- `sweep/`: the corpus sweep, every golden subject compiled once and every whole-program check run over that compile, a row each (`sweep/checks.ts`), in slices vitest runs side by side.
- `spec-suites/`: hand-written test modules for spec examples whose tests the spec elides, each run by an end-to-end test against the spec's own example code, written beside it at run time.

Principles:
 - Test commutation across transformations. Where the pipeline transforms a representation (generic → instantiated, fresh → incremental, in-memory → persisted), assert the commute law as a property: transforming then running must agree with substituting first and running directly, including degenerate inputs that collapse cases into one.
