# src

Top-level folders are toolchain features. Their layers and contracts are in `docs/arch/architecture.md`.

- `language/`: the language's fixed vocabulary (primitive names, the std modules and declarations the toolchain knows by name). Beneath every layer; it imports nothing.
- `structures/`: kind tables, `memo` and scoped stacks, the generic structures every phase builds on. Beneath every layer; it imports nothing.
- `text/`: SourceText, Span, LineMap. The foundation; it imports nothing beneath it.
- `diagnostics/`: the Diagnostic value and `defineDiagnostics`. Each phase declares one catalog; `code-blocks.ts` assigns each phase its block of codes.
- `compiler/`: the phases (`compiler/AGENTS.md`).
- `stdlib/`: the std modules, one folder each (`<name>/<name>.ista` beside its `natives.ts`, keyed as lowering keys the externs), and `stdlib-loader.ts`, which loads them by simple name from sources compiled into the package.
- `definition/`: the compiled program, the contract between lowering and the runtime (`docs/arch/definition.md`). Like `compiler/syntax/`, its modules are imported directly. Every persisted format goes through `format.ts` and `codec.ts`.
- `runtime/`: the interpreter. `host.ts` is its API (deploy a Definition's text, start and wake instances), `natives.ts` and `store.ts` its seams, `scheduler/` segments and commits, `interpreter/` the instruction table, `values/` built-in semantics such as `==`, `boundary/` values crossing to the host, and `snapshot/` the persisted instance format.
- `cli/`: the `ista` app. `cli.ts` is its composition root, `file-loader.ts` loads project files by import path, `project.ts` finds sources and picks the loaders, `report.ts` renders diagnostics, and `commands/` holds one module per subcommand.

Use a phase or feature folder only through its entry module. Upward imports and import cycles fail lint. Layers are an allow-list in `.dependency-cruiser.mjs`: a new folder can import nothing until you list it there.
