# compiler

One folder per phase. Phases share only contracts.

- `syntax/`: the token vocabulary (and later the tree). It is a contract with high fan-in: change it deliberately, and update every consumer in the same change.
- `scanner/`: `scan.ts` turns text into tokens, comments and diagnostics. It is context-free, total and lossless.

A phase has:
- an entry module named for its job
- a `diagnostics.ts` catalog
- one module per construct family beside the entry
- tests that go through the entry
