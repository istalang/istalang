# compiler

One folder per phase. Phases share only contracts.

- `syntax/`: tokens, tree nodes, operator precedence, and traversal derived from node fields. It is a contract with high fan-in: change it deliberately, and update every consumer in the same change.
- `scanner/`: `scan.ts` turns text into tokens, comments and diagnostics. It is context-free, total and lossless.
- `parser/`: tokens to tree.
  - A grammar category (`expressions/`, `types.ts`, `patterns.ts`) reaches another only through the context in `parser.ts`, which `grammar.ts` wires.
  - Pieces several categories share live in `parts/`, which imports no category.
  - dependency-cruiser enforces both rules.
  - Lists and recovery go through `recovery.ts`.

A phase has:
- an entry module named for its job
- a `diagnostics.ts` catalog
- one module per construct family beside the entry
- tests that go through the entry
