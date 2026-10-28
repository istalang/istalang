# compiler

One folder per phase. Phases share only contracts.

- `syntax/`: tokens, tree nodes, operator precedence, where items may stand, and traversal derived from node fields. Exhaustive node-kind handler tables use `structures/kind-table.ts`. It is a contract with high fan-in: change it deliberately, and update every consumer in the same change.
- `scanner/`: `scan.ts` turns text into tokens, comments and diagnostics. It is context-free, total and lossless.
- `parser/`: tokens to tree; `parse.ts` is the entry.
  - A grammar category (`expressions/`, `statements/`, `declarations/`, `types.ts`, `patterns.ts`) reaches another only through the context in `parser.ts`, which `grammar.ts` wires.
  - Pieces several categories share live in `parts/`, which imports no category.
  - dependency-cruiser enforces both rules.
  - The machinery is shared by all categories:
    - `cursor.ts`: line breaks and regions
    - `layout.ts`: items separated by `;` or line breaks (blocks, braces of entries, the module), one-line bodies, annotations on items
    - `recovery.ts`: bracketed lists and recovery
    - `nesting.ts`: the nesting limit every recursive grammar entry goes through

- `program/`: `program.ts` loads the module graph from roots through the `ModuleLoader` seam. It imposes no path syntax and does no I/O.
- `binder/`: `bind.ts` binds a program's names; `entities.ts` is the vocabulary its consumers read. Each module binds on its own (`bind-module.ts`, memoized per tree), with categories wired through the context in `local-binder.ts` as the parser's are; `flow.ts` holds where bindings are visible; `link.ts` resolves what crosses modules.
- `checker/`: `check.ts` checks a program's types and is the surface lowering reads (each body's expression types and call targets). What a call or a name may mean, the choice among candidates and the constraints met, with their witnesses, are `resolution/`'s, with type arguments inferred in `inference/`; `calls/` checks a call in a body against the function chosen; a generic body is checked once. The folders are layers, listed lowest first in `.dependency-cruiser.mjs`: a folder imports only those beneath it, and later phases import only `check.ts` and the models it names. Every pattern, a target's or a `match` case's, goes through one walk (`patterns/walk.ts`). Construct modules recurse through `context.ts`; `program-checker.ts` and `body-checker.ts` wire them. What one kind of declaration needs is a unit in `declarations/` that `program-checker.ts` composes (constants, layouts), as a body's units are.
- `lowering/`: `lower.ts` compiles what `main` reaches into a Definition, one function instance at a time (`instances.ts`, `function-lowering/`), with tables interned in `tables.ts`. Handlers live by construct in `expressions/` and `statements/`, as in the checker, and recurse through `context.ts`. Pattern tests and bindings lower in `patterns.ts`, optional chains from their last link (`optional-chains.ts`).
- `compile.ts`: the coordinator from a loaded Program onward. Only it knows the order of the phases after loading; apps ask it for results.

A phase has:
- an entry module named for its job
- a `diagnostics.ts` catalog
- one module per construct family beside the entry
- tests that go through the entry
