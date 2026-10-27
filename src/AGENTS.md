# src

Top-level folders are toolchain features. Their layers and contracts are in `docs/arch/architecture.md`.

- `language/`: the language's fixed vocabulary (primitive names, the std modules and declarations the toolchain knows by name) and its built-in `==` and map keys over any representation of values. Beneath every layer; it imports nothing.
- `structures/`: kind tables, `memo` and scoped stacks, the generic structures every phase builds on. Beneath every layer; it imports nothing.
- `text/`: SourceText, Span, LineMap. The foundation; it imports nothing beneath it.
- `diagnostics/`: the Diagnostic value and `defineDiagnostics`. Each phase declares one catalog; `code-blocks.ts` assigns each phase its block of codes.
- `compiler/`: the phases (`compiler/AGENTS.md`).
- `stdlib/`: the std modules, one folder each (`<name>/<name>.ista` beside its `natives.ts`, keyed as lowering keys the externs), each registered once in `std-modules.ts`, from which the loader and the natives table derive.
- `definition/`: the compiled program, the contract between lowering and the runtime (`docs/arch/definition.md`). Like `compiler/syntax/`, its modules are imported directly. Every persisted format goes through `format.ts` and `codec.ts`.
- `runtime/`: the interpreter. `host.ts` is its API (deploy a Definition's text; start, wake, fill, inspect, retry and terminate instances), `natives.ts` and `store.ts` its seams, `scheduler/` segments and commits, `interpreter/` the instruction table, `values/` built-in semantics such as `==`, `boundary/` host externs and what crosses to the host (`docs/arch/boundary.md`), and `snapshot/` the persisted instance format.
- `cli/`: the `ista` app. `cli.ts` is its composition root, `file-loader.ts` loads project files by import path, `project.ts` finds sources and picks the loaders, `host-module.ts` loads the host externs of `run --host`, `report.ts` renders diagnostics, and `commands/` holds one module per subcommand.

Use a phase or feature folder only through its entry module. Upward imports and import cycles fail lint. Layers are an allow-list in `.dependency-cruiser.mjs`: a new folder can import nothing until you list it there.

Reviews: a reviewer's first focus must be DRY violations, double standards (two ways to solve one problem, two shapes for one concept) and cohesion by feature. Developer or viewer, you need to have clean-dev in your context or instructions. If you don't then read it:
~/.claude/skills/clean-dev/SKILL.md
