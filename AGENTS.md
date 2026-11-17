# Istalang toolchain

Compiler, runtime and tooling for Istalang (spec: `docs/spec.md`). One npm package: ESM, TypeScript 7, Node ≥ 22.18.

## Commands

- `npm run verify`: typecheck, lint, every test, build. Tests build `dist` first, because the CLI's end-to-end test runs it. Run it before every commit.
- `npm test`: the quick suite, for iterating; it skips `src/editor`'s tests and the sweeps outside `src/compiler` (`*.sweep.test.ts`: whole-corpus checks costing seconds).
- `npm run test:full`: every test, as `verify` runs them.
- `npm run lint`, `npm run fix` (format plus safe fixes).

## Where to look

- `docs/arch/architecture.md`: folders, layers, phase contracts, seams. Read it before adding a module or importing across folders.
- `docs/work/`: plans, phase details, `tracker.md`.
- `src/`: code, organized by toolchain feature ("src" below).
- `test/`: inputs shared across phases (`test/AGENTS.md`).
- `.vscode/extensions/ista/`: VS Code highlighting for `.ista`, installed with *Developer: Install Extension from Location…*. `test/vscode-grammar.test.ts` holds its reserved words to the scanner's.

## Principles

- **Folders are by feature.** Inside a phase, they are by language construct.
- **400 lines per file at most.** A file that outgrows the limit becomes `name/index.ts`, which keeps the entry's real logic, with the extracted parts beside it.
- **No barrels or re-exports.** Import from the module that defines the thing.
- **Every file opens with a banner comment** giving the decisions and their reasons, never what the code already says. TSDoc on a function is 1–3 lines.
- **DRY.** Every rule has one home, search for existence of similar impl before a new one. Before hand-rolling a subsystem, search for a maintained library.
- **Coupling stays loose.** Phases talk through contracts (`compiler/syntax/`, later `definition/`). An open set of handlers is a typed table (`satisfies Record<Kind, Handler>`). Dependencies are passed in at composition roots, with no DI container and no import side effects.
- **Derive, never mirror.** Memoize derived data, keyed by its immutable input. Never store a copy and sync it.
- **Reduce** to existing features where you can, instead of a 2nd similar implementation. Prefer .ista impl over builtin/ts implementation.
- **Tests sit beside their code** as `*.test.ts`, with shared helpers in `*.test-kit.ts`; a sweep run in slices registers its tests from `*.sweep.ts` (`test/slices.ts`). Prefer properties over generated, broken and hostile inputs (fast-check) to snapshots of one observed output.
- **Biome runs every stable rule as an error**, including the project, type-aware and test domains. Each exception in `biome.jsonc` states its reason. dependency-cruiser enforces the layers.
- Alway implement a **robust** approach, never a hacky solution to fix a specific case. If it can be written in a generic way to be used in other places too, do it and refactor those other places too.
- When different units-of-code have incompatible APIs, your first try must be to **refactor and unify** them, not writing a new wrapper adding more code to maintain.
- Normalize at construction, in one place. When a value or type has a canonical form, its constructor enforces the whole invariant, and every path that produces one (resolution, substitution, deserialization) builds through that constructor.  If a layer boundary keeps the constructor from a rule it needs, pass the rule in through a seam — never split normalization between the constructor and a few callers.
 - Contracts carry semantics, never premature layout. A phase records what a construct means in its own types, never the physical offsets, steps or booleans a later phase will emit, especially across a transformation (such as generic instantiation) that can collapse or reshape cases. The later phase derives layout from the final, concrete shape; nothing patches a pre-baked layout after the fact.
 - One representation per meaning; no punning. Never overload one primitive, index or sentinel (0, undefined, a bottom type) to mean two different things ("field 0" vs. "unwrap wrapper", "unconstrained" vs. "constrained to bottom"). Give each meaning its own variant in the union so consumers dispatch on it instead of reconstructing how it got there.
 - Probes do not mutate. A check that tests whether a candidate, branch or conversion applies leaves no state behind when it fails. Never thread a stateful accumulator through a search or fallback chain unless failed probes roll back or non-speculative choices run first.
- **Commits are one line, Angular style** (`feat(scanner): …`), with no body and no attribution.

# src

Top-level folders are toolchain features. Their layers and contracts are in `docs/arch/architecture.md`.

- `foundation/`: what every phase builds on.
  - `language/`: the language's fixed vocabulary (primitive names, the std modules and declarations the toolchain knows by name) and its built-in `==` and map keys over any representation of values. Beneath every layer; it imports nothing.
  - `structures/`: kind tables, `memo` and scoped stacks, the generic structures every phase builds on. Beneath every layer; it imports nothing.
  - `text/`: SourceText, Span, LineMap, and code points in UTF-16 text. It imports nothing.
  - `diagnostics/`: the Diagnostic value and `defineDiagnostics`. Each phase declares one catalog; `code-blocks.ts` assigns each phase its block of codes.
- `compiler/`: the phases (`compiler/AGENTS.md`).
- `stdlib/`: the std modules, one folder each (`<name>/<name>.ista` beside its `natives.ts`, keyed as lowering keys the externs), each listed once in `std-sources.ts`, which the loader reads; `std-modules.ts` attaches each module's natives, and the natives table derives from it.
- `definition/`: the compiled program, the contract between lowering and the runtime (`docs/arch/definition.md`). Like `compiler/syntax/`, its modules are imported directly. Every persisted format goes through `formats/format.ts` and `formats/codec.ts`.
- `codegen/`: a Definition as one JavaScript ES module (`emit.ts`), the only backend (`docs/arch/codegen.md`); `calling-convention.ts` holds its one calling-convention rule.
- `live/`: the `istalang/live` entry (`program.ts`): a built program's module, started by key on the std's natives through `runtime/program.ts`, with no Node built-in, so it bundles for a browser.
- `runtime/`: the run (`docs/arch/runtime.md`). `run/` one Run per instance over compiled code, `host/` the host runtime (`index.ts`: deploy, wake, inspect, retry, terminate; `durable-world.ts`: segments and commits), `snapshot/` the persisted instance format, `boundary/` host externs and what crosses to the host (`docs/arch/boundary.md`), `natives.ts` and `store.ts` its seams, `program.ts` a live start over a store of its own.
- `project/`: a project on disk, for every app: `project.ts` finds sources and picks the loaders and roles, `file-loader.ts` loads project files by import path.
- `formatter/`: a syntax tree to its canonical text; `format.ts` is its entry and the `istalang/formatter` API, with one printer table per family of constructs and comments placed on nodes (`comments/comment-placement.ts`).
- `editor/`: editor support, from features to protocol to client.
  - `language-service/`: what an editor asks of a project, with no protocol and no I/O: the workspace (open texts and the program they make, `workspace.ts`), one module or folder per feature, and what features read of a module at a spot (`reading/`).
  - `lsp/`: the language server over vscode-languageserver; `server.ts` composes it, `providers/` holds one provider per request (the navigation ones in `providers/navigation/`, the outline ones in `providers/outline/`), and `ista lsp` runs it.
  - `vscode-client/`: the VS Code extension's client of `ista lsp`: `extension.ts` activates it and serves the `std:` documents, `server-command.ts` picks the `ista lsp` process a workspace runs. It imports of the server only `editor/lsp/std-source-request.ts`.
- `cli/`: the `ista` app. `cli.ts` is its composition root, `compile-entry.ts` compiles the program `run` and `build` take, `host-module.ts` loads the host externs of `run --host`, `report.ts` renders diagnostics, and `commands/` holds one module per subcommand.

Use a phase or feature folder only through its entry module. Upward imports and import cycles fail lint. Layers are an allow-list in `.dependency-cruiser.mjs`: a new folder can import nothing until you list it there.

## Reuse index (`docs/reuse/`)

`docs/reuse/` indexes the reusable units, one-way rules and extension recipes already in this codebase, grouped by the caller's need. Before writing a helper or choosing how to solve a recurring problem, read the matching file; when you add, rename, move or delete a reusable unit or a one-way rule, update its line in the same commit:

- `docs/reuse/structures-and-invariants.md`: caching derived data (`memo`), dispatching over union `kind`s (`Handlers`), walking deep graphs/stacks, or throwing on broken invariants (`unreachable`).
- `docs/reuse/text-and-positions.md`: working with `SourceText`, `Span`, line/column maps, Unicode code points in UTF-16 text, or time-unit ratios.
- `docs/reuse/diagnostics.md`: adding, reporting, rendering or testing diagnostics and per-phase catalogs.
- `docs/reuse/syntax-and-trees.md`: inspecting or adding tokens, syntax nodes, operators, places, optional chains, field defaults, templates, or tree traversal.
- `docs/reuse/modules-and-names.md`: looking up well-known declarations/functions, spelling static/qualified/extern names, loading modules, or reading bound entities.
- `docs/reuse/types-and-fitting.md`: building, comparing, substituting, printing or fitting checker `Type`s, well-known types, trait constraints, patterns, or body data flow.
- `docs/reuse/calls-and-resolution.md`: finding call/witness candidates, resolving overloads, inferring type arguments, or making implicit/prelude calls.
- `docs/reuse/lowering-and-ir.md`: lowering expressions/statements to Definition IR, interning tables, closing function instances, emitting calls/loops/places, or writing synthesized code.
- `docs/reuse/values-and-equality.md`: building, narrowing or reading language `Value`s, structs, variants, closures, maps or JSON from TypeScript, or comparing values with `==`.
- `docs/reuse/stdlib-and-natives.md`: adding or editing a std module, native function, sequence index/slice/range helper, text parser/formatter, or `.ista` test helper.
- `docs/reuse/runtime-and-persistence.md`: changing persisted formats, canonical JSON codecs, snapshots, heap objects, disposal, scheduler wakes, or the host API.
- `docs/reuse/testing.md`: writing or editing `*.test.ts` or `*.test-kit.ts` files, fast-check arbitraries, spec-example tests, or Definition fixtures.

Reviews: a reviewer's first focus must be DRY violations, double standards (two ways to solve one problem, two shapes for one concept) and cohesion by feature. Developer or viewer, you need to have clean-dev in your context or instructions. If you don't then read it:
~/.claude/skills/clean-dev/SKILL.md
