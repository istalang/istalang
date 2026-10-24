---
description: istalang toolchain architecture — folder hierarchy, layers, phase contracts, seams, registries and composition; read before adding a module or importing across folders
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-25
tags: [architecture, compiler, runtime, tooling]
---

# Architecture

## Shape

- One npm package, `istalang`: ESM, Node ≥ 22, TypeScript 7.0 (stable), vitest + fast-check, Biome 2. M1.1 pins exact versions.
- The build is tsdown (JavaScript, mirroring `src`) plus tsc (declarations). Std `.ista` sources are imported as text and compiled into the package, so nothing reads them from disk at run time.
- One bin, `ista` (commander), with subcommands `check`, `fmt`, `test`, `lsp`, `run`, `vendor` and `verify`.
- Host projects import subpath exports (`istalang/compiler`, `istalang/runtime`, `istalang/language-service`). Each export maps to a real module, never a re-exporting barrel.
- `editors/vscode/` is a separate npm workspace holding the LSP client and the TextMate grammar. It is added with the LSP milestone.

## Pipeline

```
text ─scan─▶ tokens ─parse─▶ SyntaxTree ──┐
ModuleLoader(s) ──────────────────────────┴─▶ Program (immutable module-graph snapshot)
Program ─bind─▶ Bindings ─check─▶ types ─lower─▶ Definition (serializable IR)
Definition ─▶ runtime: interpret it over persisted instance snapshots
```

Loading (scan, parse, resolve imports) belongs to `compiler/program/`, because finding a module's imports needs its tree. From a Program onward, `compiler/compile.ts` is the coordinator: it alone knows the phase order, and each phase knows only its input and output.

## Folders (`src/`)

The top level is split by toolchain feature. Inside a phase, folders are split by language construct. No file is longer than 400 lines. A file that grows past that becomes a folder of the same name: `parse.ts` becomes `parse/index.ts`, which keeps the entry's real logic, with the extracted parts beside it.

```
src/
  text/                 SourceText, Span (UTF-16 offsets), LineMap
  diagnostics/          Diagnostic model, per-phase catalog helper, renderer
  compiler/
    syntax/             contract: token kinds, tree node types, where items may stand, generic traversal, node-at-offset
    scanner/            text → tokens + comments + diagnostics
    parser/             tokens → SyntaxTree; parse.ts is the entry
      parser.ts grammar.ts                                       context, category wiring
      cursor.ts layout.ts recovery.ts nesting.ts annotations.ts  line regions, blocks and bodies, lists, depth limit, annotations
      parts/                                                     pieces every category may import; imports no category
      expressions/ patterns types statements declarations        by construct (Pratt parselets in expressions/)
    program/            Program snapshot, module graph, the ModuleLoader seam; imposes no path syntax
    binder/             entities, scopes, imports/exports, name resolution
    checker/            check.ts is the entry and the surface later phases read
      context.ts program-checker.ts body-checker.ts              contexts and the classes that wire them
      types/ declarations/ expressions/ statements/              type model and per-construct rules
      inference/ overloads/ traits/ patterns/ rules/             cross-cutting engines and semantic rules
    lowering/           checked program → Definition (all desugaring lives here); lower.ts is the entry
      context.ts function-lowering.ts tables.ts names.ts         one function's code, the interned tables, qualified names
      expressions/ statements/ not-lowered.ts                    per-construct handlers, as in the checker
    compile.ts          pipeline coordinator and public compiler API
  definition/           contract: the compiled program (docs/arch/definition.md): canonical JSON codec,
                        versioned formats, values, types, instruction set
  runtime/
    values/ interpreter/ scheduler/ handles/ disposal/ snapshot/ boundary/
    natives.ts          the Natives seam, the context a native is called with, and the Panic it throws
    store.ts            the InstanceStore seam, and a store in memory
    instance-state.ts   where an instance stands after the runtime advanced it
    host.ts             public host API: createRuntime(seams) → deploy, start, wake
  stdlib/               stdlib-loader.ts: the std ModuleLoader (simple name → embedded source) and the std names; natives.ts: every std native in one table; natives-kit.ts: what natives share; prelude/ and one folder per std module: <module>.ista + natives.ts
  formatter/            SyntaxTree → text; one printer per construct
  language-service/     editor-agnostic queries over Program snapshots; one folder per feature
  lsp/                  LSP adapter (vscode-languageserver): server.ts root, one provider per feature
  test-runner/          discover @Suite functions, run each test in a fresh in-memory instance
  packages/             ista.json, minimal version selection, lockfile, vendor, verify, vendor loader
  cli/                  main.ts executable, cli.ts root, file-loader.ts (the project files ModuleLoader), project.ts (sources, loaders), report.ts (diagnostics output), commands/
test/corpus/            shared .ista corpus (spec examples, valid/invalid cases) used by every phase
```

## Layers

Imports point only downward; cycles are forbidden. Both rules are enforced by lint, not left to review.

```
cli · lsp · test-runner                 apps (composition roots); nothing imports them
language-service · formatter · packages tooling
compiler/compile ─▶ lowering ─▶ checker ─▶ binder ─▶ program ─▶ parser · scanner ─▶ syntax
runtime ─▶ definition ◀─ lowering       runtime never imports compiler/
stdlib ─▶ program (loader seam) · runtime native seam
text · diagnostics                      foundation
```

- A phase or feature folder is used only through its entry module, which is named for what it does (`scanner/scan.ts`, `parser/parse.ts`). Nothing reaches into another folder's internals. The foundation folders (`text/`, `diagnostics/`) are small vocabularies, used module by module.
- `syntax/` and `definition/` are contracts with high fan-in. Change them deliberately, and update every caller in the same change.
- Mechanisms:
  - Biome `noExcessiveLinesPerFile` enforces the 400-line limit.
  - Biome `noImportCycles` (project domain) forbids cycles.
  - dependency-cruiser enforces the layers as an allow-list over resolved paths (`.dependency-cruiser.mjs`). A layer not listed there can import nothing. Biome's import rules match specifiers, whose shape depends on directory depth, so they can't state an allow-list.
  - npm packages may be imported by any layer. Node's built-ins only by apps: the layers beneath reach files, processes and clocks through seams. The one exception is `definition/` using `crypto` for content hashes, which is computation, not I/O.

## Phase contracts

| Phase | Signature | Invariants |
| --- | --- | --- |
| source | `createSourceText(path, contents) → SourceText` | The only way to make a SourceText (it is branded). It drops a leading byte order mark, so no phase ever sees one. |
| scan | `scan(source) → { tokens, comments, diagnostics }` | Context-free, total and lossless: never throws, and every character belongs to exactly one token, comment or whitespace run. It emits no INDENT/DEDENT. Tokens carry `firstOnLine`, and columns come from `LineMap`. The result type `ScanResult` lives in `syntax/`, so the parser depends on the contract, not on the scanner. |
| parse | `parse(source, scanned) → SyntaxTree` | Total: always returns a full tree, with errors as `Missing`/`Invalid` nodes plus diagnostics. It owns layout (indentation blocks, newline-insensitive brackets, `{` as block vs struct literal vs field list), because layout depends on syntactic context. |
| tree | immutable plain objects, discriminated by `kind`, with a `span` | No parent pointers; parents are derived on demand. Child traversal is derived generically from node fields, never hand-listed per kind. A node field is therefore a node, a node array, an optional node, or a primitive. Nodes hold no tokens and no resolved references; the binder and checker keep those in side tables. |
| program | `buildProgram({ roots, loaders, prelude?, time? }, previous?) → Program { roots, prelude, time, modules: Map<ModuleId, ProgramModule { name, isStd, tree, imports, diagnostics }> }` | Immutable. Roots arrive located, and so do the std modules the language refers to, by role: the prelude every module sees, and `time`, which types duration literals (§2); the checker reads them from these roles, never from an id. A loader marks the modules the toolchain ships (`isStd`), whose externs need no host. Every loader is asked for every import path, as written; the core imposes no path syntax and does no I/O itself. Its one rule is the language's: a path names exactly one module (distinct ids); otherwise a diagnostic on the path. The core reads a module only when it loads it, once per build, and makes its SourceText. A module id is its source's URL (any scheme), branded and made only from a parsed URL; two paths to one module must yield one id. Building with the previous snapshot reuses every tree whose text is unchanged, by identity. `imports` maps each import node to its module. |
| compile | `diagnose(program) → Map<ModuleId, ModuleDiagnostics { source, diagnostics }>`, `compileProgram(program, entry) → compiled { definition } \| failed \| noMain` | The coordinator's results, memoized per Program: every module's diagnostics from every phase so far, sorted by position, keyed by module id, clean modules included so an editor knows which documents to clear. A program with any error doesn't compile; `main` is the entry module's `async fn main()` (§9). |
| bind | `bindProgram(program) → Bindings { entityOf(module, name), exportsOf, moduleOf, overloadsOf, candidatesOf, diagnosticsOf }` | Every entity is made while binding one tree, memoized on that tree (`bind-module.ts`): an unchanged module keeps the identity of every entity it declares or refers to across snapshots, and an entity points at its declaring syntax and holds nothing derived. What depends on the whole program is a query memoized per Program: imports, the prelude (the `Program`'s `prelude` module), a function set joined with the prelude's overloads (`overloadsOf`), a bare name's candidate variants (`candidatesOf`), qualified names. Lookups that need types (members, methods, static functions, ADL, picking a variant candidate) are the checker's. |
| check | `checkProgram(program) → Checker { diagnosticsOf(module), moduleOf, parametersOf, resultOf, bodyOf(function) → CheckedBody { typeOf(expression), callOf(site) → ResolvedCall { function, typeArguments }, result }, fieldsOf(type) }` | Memoized per Program and lazy: a body is checked the first time anything needs it (its module's diagnostics, lowering, or inferring a caller's result), so the LSP pays only for what it asks. Binding happens inside: the checker calls the memoized `bindProgram`. A body records each expression's type and each call site's target (calls, operators, compound assignments) as it is checked, so lowering reads exactly what was checked and never re-derives a type. Types are `types/type.ts` values: a nominal type is its declaration's binder entity plus type arguments. |
| lower | `lower(checker, main) → Definition` | Runs only on an error-free program. It compiles what `main` reaches, through a worklist, since generics are compiled per instantiation. The Definition is complete: linear register code with no unresolved names and no sugar, one entry per generic instantiation, and every call targeting a function-table entry (definition.md). Names are qualified with each module's canonical `name`, so a Definition and its content hash never depend on where the toolchain ran. An extern's key is built only by `externKey` (`definition/extern-key.ts`): module, name and declared parameter types, module-qualified (`prelude.add(int, float)`, `geometry.place(geometry.Point)`). Every nominal type can be laid out (struct, enum, extern). Loading validates indexes, call arity, closure captures, termination and where waiting is allowed, so the interpreter can trust what it reads. |
| run | `createRuntime({ natives, store, now, crashEveryAwait? }) → { deploy(text) → { hash, functions, json(value), start(instance) }, wake(instance), programOf(instance) }`; `start` and `wake` → `InstanceState`: waiting until a time, finished with a value, or panicked | Deploying reads a Definition's persisted text, binds every extern to a native (a missing one refuses the Definition before anything runs) and stores it by hash. `start` and `wake` advance an instance segment by segment (scheduler/): a driver's `await` ends a segment, which commits through the store before the next runs; an async callee runs eagerly inside its caller's segment. Waking reads the snapshot and its Definition from the store and checks one against the other before restoring. The runtime holds no timers: a waiting state names when its earliest timer is due, and the host wakes it then. A refusal is a `Refusal` (`runtime/refusal.ts`); with the FormatError of an invalid or unknown-version text, it is all a host catches. `functions` is the function table every call goes through, which `mock` replaces entries of; `json` turns a value into what a host receives (§9). |

Sugar is split by whether it has typing consequences:
- **Resolved in the checker** (it affects types or diagnostics): default parameters become overloads (and a clash is an error); `T?` is `Optional<T>`; operators, `$`, indexing, `for` and `T(x)` become resolved function calls; compound index assignment requires a `let`; closure captures become `Shared` values.
- **Done mechanically in lowering**, following the checker's decisions: overload bodies, capture structs, `defer` guards, `?.`/`??`/`is` as `match`, comprehensions as loops.

Each phase returns its diagnostics as values; there is no global sink. Codes are unique, with one catalog per phase.

## Seams and composition

A seam is an interface owned by its consumer. Each app's composition root picks the implementations; no module constructs its own collaborators.

| Seam | Owner | Implementations |
| --- | --- | --- |
| `ModuleLoader` | program | `(path, importer) → { id, name, label, read(), isStd? } \| undefined`: locates the module the string in an import names, without reading it. `name` is the module's canonical name, the import path that names it from anywhere (`purchase/approve`, `time`), which compiled code is qualified with; `label` is how diagnostics show it, and may depend on where the toolchain runs; the core calls `read` once, when it loads the module. Implementations: the project's files (`cli/file-loader.ts`, which owns the toolchain's path syntax, §3.13), the std modules (`stdlib/stdlib-loader.ts`, simple names, embedded sources), later vendored packages and an editor overlay, in-memory (tests). A host may pass any loaders of its own. Every loader answers every path: two different modules for one path is an error, and when two locate the same module the first one is used, so an overlay that must win is listed first. |
| `InstanceStore` | runtime | in memory (tests, `ista run`), a directory (`ista run --store`, atomic by rename), or host-provided persistence. It keeps texts: each Definition once, by content hash, which an instance references for its whole life, and each instance's last snapshot by name. Definitions and snapshots both carry a format version; in v0.1 the runtime refuses any version it doesn't know. |
| `Natives` (extern bindings by module-qualified name) | runtime | stdlib natives (`stdlib/natives.ts`), host externs (`ista run --host <module>` loads a module that exports a table), test mocks. Each call gets a context: the entry called, the segment's start time, and the futures the runtime creates for an extern returning one. |
| `now` | runtime | the host's clock in milliseconds since the epoch: each segment's start, which `time.now()` returns and which due timers are resolved against. The host wakes an instance when its waiting state says its earliest timer is due; `ista run` sleeps until then. Programs fake time only through `mock(time.at, …)` (§10), not through this seam. |
| `Logger` | runtime | host-provided; the `log` std module routes to it |

## Registries

An open set of handlers is an explicit typed table, assembled in one module and made exhaustive by type. Node-kind tables use `Handlers` from `compiler/syntax/handlers.ts`. Adding a node kind therefore fails compilation until every phase handles it. Self-registration through import side effects is not used. Tables of this kind:

- parser: prefix and infix parselets by token kind; statements and declarations by leading keyword
- binder, checker, lowering, formatter, interpreter: one handler per node kind
- LSP providers, CLI commands, std natives, diagnostic catalogs

The handler types of the phases from checking on, which feature slices extend:

| Table | Type | A handler… |
| --- | --- | --- |
| checker expressions | `Handlers<BodyContext, Expression, [expected: Type \| undefined], Type>` | gives the node's type; `expected` guides inference, and `BodyContext.expect` enforces it where the spec says a value must fit |
| checker statements | `Handlers<BodyContext, Statement \| Invalid, [expected: Type \| undefined], Type>` | gives the statement's type: an expression statement's value, `never` for one that leaves, else `unit` |
| checker declarations | `Handlers<CheckerContext, Declaration, [ModuleId], void>` | resolves what a top-level item declares and checks bodies |
| checker type nodes | `Handlers<Resolution, TypeNode, [], Type>` | gives the type a type node denotes |
| lowering expressions | `Handlers<FunctionContext, Expression, [], Register>` | emits the code and gives the register holding the value |
| lowering statements | `Handlers<FunctionContext, Statement \| Invalid, [], void>` | emits the code |
| interpreter | `{ [Kind in InstructionKind]: (Machine, ActiveFrame, instruction) => void }` | runs the top frame's instruction and moves its pc |

Construct modules reach each other only through their context (`BodyContext`, `CheckerContext`, `FunctionContext`, `Machine`), as the parser's categories do through the grammar. A construct not supported yet shares one entry per table: the checker reports it (`notSupportedYet`, code 5000), and lowering and the interpreter refuse it. The checker is the one frontier: it also reports what lowering, the natives or the boundary can't take yet (an async call, an extern only a host implements). Lowering's totality property (every program that checks clean compiles into a Definition the runtime loads) holds the two together. A feature slice replaces its kinds' entries and moves the frontier.

Node kinds are PascalCase, so a table keyed by them sits between `biome-ignore-start` and `biome-ignore-end` comments for `useNamingConvention`, and nowhere else is the rule suppressed.

## State: derive, never mirror

Every analysis result is a memoized function of immutable inputs: text → tokens → tree → Program → bindings → types. Caches are keyed by the input object (a `WeakMap`), so a new snapshot is a new key and nothing is ever invalidated by hand. The LSP holds only document texts and derives everything else. The runtime's only state is the instance snapshot.

## Decisions

- **Hand-written scanner and parser** (Pyright/TypeScript style). Rejected:
  - Langium: its indentation lexer can't turn layout back on for a `{}` block inside `(…)`, and Typir has no generics.
  - Chevrotain, Lezer, tree-sitter: they give untyped CSTs, and context-dependent `{` and generic-call speculation would fight the grammar.
- **No DI container.** Explicit composition roots plus registries keep wiring visible and type-checked.
- **Positions are UTF-16 offsets**, the LSP default. They are converted only at the edges.
- **Formatter layout algorithm comes from a library** (a Wadler-style doc printer such as Prettier's). Which one is decided at the formatter milestone.
- **Runtime keeps frames as data.** The Definition is linear register code, so a frame is a function, a pc and registers, and any `await` can be persisted (spec §5). Code is untyped, and generics are compiled per instantiation. The chosen and rejected options are in definition.md, Decisions.
- **One description per persisted format.** A zod schema validates, decodes and encodes it; texts are canonical JSON (lossless-json with sorted keys) nested in a `{format, version, body}` envelope, keyed by content hash. The codec and envelope live in `definition/` (`codec.ts`, `format.ts`), the lowest layer every persisted format already depends on; `runtime/` (snapshots, and from M3 the boundary) imports them from there. Values use `bigint` for `int`, `decimal.js` for `Decimal` and `re2js` for `regex`.
- **Test capabilities are built into the runtime** (spec §10):
  - Every call goes through a function table, so `mock` can replace any named function.
  - `testing.start`, `handle<T>()` and `crashEveryAwait` are runtime capabilities.
  - `test-runner/` is only the app plus the library written in the language.

## Testing

- vitest with fast-check, with tests colocated as `*.test.ts`.
- Properties check totality and round trips:
  - the scanner is lossless
  - the parser never throws and covers every token
  - the formatter is idempotent and preserves the tree
- Each spec section also gets table-driven valid and invalid inputs.
- `test/corpus/` is shared by every phase. End-to-end tests run through the `ista` CLI.
