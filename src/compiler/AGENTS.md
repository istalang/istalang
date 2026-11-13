# compiler

One folder per phase. Phases share only contracts.

- `syntax/`: tokens and the words each grammar position starts with (`tokens/`: `grammar-words.ts`), tree nodes and traversal derived from node fields (`tree/`), operator precedence (`expressions/operators.ts`), where items may stand and the annotations they carry (`items.ts`). Exhaustive node-kind handler tables use `foundation/structures/kind-table.ts`. It is a contract with high fan-in: change it deliberately, and update every consumer in the same change.
- `scanner/`: `scan.ts` turns text into tokens, comments and diagnostics. It is context-free, total and lossless.
- `parser/`: tokens to tree; `parse.ts` is the entry.
  - `grammar/`: a grammar category (`expressions/`, `statements/`, `declarations/`, `types.ts`, `patterns.ts`) reaches another only through the context in `parser.ts`, which `grammar/index.ts` wires.
    - Pieces several categories share live in `grammar/parts/`, which imports no category.
    - dependency-cruiser enforces both rules.
    - `nesting.ts`: the nesting limit every recursive grammar entry goes through
    - `word-parselets.ts`: tables keyed by the words of `syntax/tokens/grammar-words.ts`, which completion offers, checked against them both ways by type
  - The machinery is shared by all categories:
    - `cursor/`: line breaks and regions (`regions.ts`: one shape per kind), brackets paired (`brackets.ts`), bracketed lists and recovery (`recovery.ts`)
    - `layout/`: items separated by `,`, `;` (statements and the module's declarations) or line breaks (blocks, braces of entries) and annotations on items (`index.ts`, `annotations.ts`), one-line bodies (`bodies.ts`), docstrings (`docstrings.ts`)

- `program/`: `program.ts` loads the module graph from roots through the `ModuleLoader` seam. It imposes no path syntax and does no I/O.
- `binder/`: `bind.ts` binds a program's names; `entities.ts` is the vocabulary its consumers read. Each module binds on its own (`module/bind-module.ts`, memoized per tree), with the categories in `constructs/` wired through the context in `module/local-binder.ts` as the parser's are; `module/flow.ts` holds where bindings are visible; `link/` resolves what crosses modules, over the modules `bind.ts` bound.
- `checker/`: `check.ts` checks a program's types and is the surface lowering reads (each body's expression types and call targets). Its folders are layers, listed lowest first in `.dependency-cruiser.mjs`, and a folder holding several is a run of them:
  - `types/`: the type model, then `inference/` (type arguments inferred), then `traits/`.
  - `resolution/`: what a call or a name may mean, the choice among candidates and the constraints met, with their witnesses; a chosen call applied in `applying/`; then `calls/`, which checks a call in a body against the function chosen.
  - `rules/`: `flow/`, then the rules constructs share.
  - `constructs/`: `patterns/`, `loops/`, `declarations/`, `closures/`, `expressions/`, `statements/`.
  - `lookup/`: what tools ask by position.

  A layer imports only those beneath it, and later phases import only `check.ts` and the models it names. A generic body is checked once. Every pattern, a target's or a `match` case's, goes through one walk (`constructs/patterns/walk/index.ts`). Construct modules recurse through the contexts in `contexts/`; `wiring/` wires them (`program/program-checker.ts`, `body/body-checker.ts`). What one kind of declaration needs is a unit in `constructs/declarations/` that `program-checker.ts` composes (constants, layouts), as a body's units are.
- `lowering/`: `lower.ts` compiles what `main` reaches into a Definition, one function instance at a time (`tables/instances.ts`, `functions/`), with tables interned in `tables/`. A body is written from its flow (the checker's `CheckedBody.flowOf`): `flow/` maps each operation and exit to instructions, through `context.ts`; code with no syntax behind it is written in `synthesized/`.
- `compile.ts`: the coordinator from a loaded Program onward. Only it knows the order of the phases after loading; apps ask it for results.

A phase has:
- an entry module named for its job
- a `diagnostics.ts` catalog
- one module per construct family beside the entry
- tests that go through the entry
