# src

Top-level folders are toolchain features. Their layers and contracts are in `docs/arch/architecture.md`.

- `language/`: the language's fixed vocabulary (primitive names, the std modules and declarations the toolchain knows by name) and its built-in `==` and map keys over any representation of values. Beneath every layer; it imports nothing.
- `structures/`: kind tables, `memo` and scoped stacks, the generic structures every phase builds on. Beneath every layer; it imports nothing.
- `text/`: SourceText, Span, LineMap, and code points in UTF-16 text. The foundation; it imports nothing beneath it.
- `diagnostics/`: the Diagnostic value and `defineDiagnostics`. Each phase declares one catalog; `code-blocks.ts` assigns each phase its block of codes.
- `compiler/`: the phases (`compiler/AGENTS.md`).
- `stdlib/`: the std modules, one folder each (`<name>/<name>.ista` beside its `natives.ts`, keyed as lowering keys the externs), each listed once in `std-sources.ts`, which the loader reads; `std-modules.ts` attaches each module's natives, and the natives table derives from it.
- `definition/`: the compiled program, the contract between lowering and the runtime (`docs/arch/definition.md`). Like `compiler/syntax/`, its modules are imported directly. Every persisted format goes through `formats/format.ts` and `formats/codec.ts`.
- `runtime/`: the interpreter. `host.ts` is its API (deploy a Definition's text; start, wake, fill, inspect, retry and terminate instances), `natives.ts` and `store.ts` its seams, `scheduler/` segments and commits, `interpreter/` the instruction table, `values/` built-in semantics such as `==`, `boundary/` host externs and what crosses to the host (`docs/arch/boundary.md`), and `snapshot/` the persisted instance format.
- `project/`: a project on disk, for every app: `project.ts` finds sources and picks the loaders and roles, `file-loader.ts` loads project files by import path.
- `language-service/`: what an editor asks of a project, with no protocol and no I/O: the workspace (open texts and the program they make, `workspace.ts`) and one module or folder per feature.
- `formatter/`: a syntax tree to its canonical text; `format.ts` is its entry and the `istalang/formatter` API, with one printer table per family of constructs and comments placed on nodes (`comments/comment-placement.ts`).
- `lsp/`: the language server over vscode-languageserver; `server.ts` composes it, `providers/` holds one provider per request (the navigation ones in `providers/navigation/`), and `ista lsp` runs it.
- `cli/`: the `ista` app. `cli.ts` is its composition root, `host-module.ts` loads the host externs of `run --host`, `report.ts` renders diagnostics, and `commands/` holds one module per subcommand.
- `vscode-client/`: the VS Code extension's client of `ista lsp`: `extension.ts` activates it and serves the `std:` documents, `server-command.ts` picks the `ista lsp` process a workspace runs. It imports of the server only `lsp/std-source-request.ts`.

Use a phase or feature folder only through its entry module. Upward imports and import cycles fail lint. Layers are an allow-list in `.dependency-cruiser.mjs`: a new folder can import nothing until you list it there.

## Reuse index (`docs/reuse/`)

`docs/reuse/` indexes the reusable units, one-way rules and extension recipes already in this codebase, grouped by the caller's need. Before writing a helper or choosing how to solve a recurring problem, read the matching file; when you add, rename, move or delete a reusable unit or a one-way rule, update its line in the same commit:

- `docs/reuse/structures-and-invariants.md`: caching derived data (`memo`), dispatching over union `kind`s (`Handlers`), walking deep graphs/stacks, or throwing on broken invariants (`unreachable`).
- `docs/reuse/text-and-positions.md`: working with `SourceText`, `Span`, line/column maps, Unicode code points in UTF-16 text, or time-unit ratios.
- `docs/reuse/diagnostics.md`: adding, reporting, rendering or testing diagnostics and per-phase catalogs.
- `docs/reuse/syntax-and-trees.md`: inspecting or adding tokens, syntax nodes, operators, places, optional chains, field defaults, templates, or tree traversal.
- `docs/reuse/modules-and-names.md`: looking up well-known constructs/declarations/functions, spelling static/qualified/extern names, loading modules, or reading bound entities.
- `docs/reuse/types-and-fitting.md`: building, comparing, substituting, printing or fitting checker `Type`s, well-known types, trait constraints, patterns, or body data flow.
- `docs/reuse/calls-and-resolution.md`: finding call/witness candidates, resolving overloads, inferring type arguments, or making implicit/prelude calls.
- `docs/reuse/lowering-and-ir.md`: lowering constructs/expressions/statements to Definition IR, interning tables, closing function instances, emitting resolution/calls/loops/places, or writing synthesized code.
- `docs/reuse/values-and-equality.md`: building, narrowing or reading language `Value`s, structs, variants, closures, maps or JSON from TypeScript, or comparing values with `==`.
- `docs/reuse/stdlib-and-natives.md`: adding or editing a std module, native function, sequence index/slice/range helper, text parser/formatter, or `.ista` test helper.
- `docs/reuse/runtime-and-persistence.md`: changing persisted formats, canonical JSON codecs, snapshots, heap objects, disposal, scheduler wakes, or the host API.
- `docs/reuse/testing.md`: writing or editing `*.test.ts` or `*.test-kit.ts` files, fast-check arbitraries, spec-example tests, or Definition fixtures.

Reviews: a reviewer's first focus must be DRY violations, double standards (two ways to solve one problem, two shapes for one concept) and cohesion by feature. Developer or viewer, you need to have clean-dev in your context or instructions. If you don't then read it:
~/.claude/skills/clean-dev/SKILL.md
