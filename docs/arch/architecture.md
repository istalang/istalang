---
description: istalang toolchain architecture — folder hierarchy, layers, phase contracts, seams, registries and composition; read before adding a module or importing across folders
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-24
tags: [architecture, compiler, runtime, tooling]
---

# Architecture

## Shape

- One npm package, `istalang`: ESM, Node ≥ 22, TypeScript 7.0 (stable), vitest + fast-check, Biome 2. M1.1 pins exact versions.
- One bin, `ista` (commander), with subcommands `check`, `fmt`, `test`, `lsp`, `run`, `vendor` and `verify`.
- Host projects import subpath exports (`istalang/compiler`, `istalang/runtime`, `istalang/language-service`). Each export maps to a real module, never a re-exporting barrel.
- `editors/vscode/` is a separate npm workspace holding the LSP client and the TextMate grammar. It is added with the LSP milestone.

## Pipeline

```
text ─scan─▶ tokens ─parse─▶ SyntaxTree ──┐
SourceHost + ModuleResolver ───────────────┴─▶ Program (immutable module-graph snapshot)
Program ─bind─▶ Bindings ─check─▶ types ─lower─▶ Definition (serializable IR)
Definition ─▶ runtime: interpret it over persisted instance snapshots
```

`compiler/compile.ts` is the coordinator. It alone knows the phase order; each phase knows only its input and output.

## Folders (`src/`)

The top level is split by toolchain feature. Inside a phase, folders are split by language construct. No file is longer than 400 lines. A file that grows past that becomes a folder of the same name: `parse.ts` becomes `parse/index.ts`, which keeps the entry's real logic, with the extracted parts beside it.

```
src/
  text/                 SourceText, Span (UTF-16 offsets), LineMap
  diagnostics/          Diagnostic model, per-phase catalog helper, renderer
  compiler/
    syntax/             contract: token kinds, tree node types, generic traversal, node-at-offset
    scanner/            text → tokens + comments + diagnostics
    parser/             tokens → SyntaxTree
      parser.ts grammar.ts cursor.ts recovery.ts                 context, category wiring, line regions, lists
      parts/                                                     pieces every category may import; imports no category
      expressions/ patterns types statements declarations        by construct (Pratt parselets in expressions/)
    program/            Program snapshot, module graph, SourceHost + ModuleResolver seams, relative resolver
    binder/             symbols, scopes, imports/exports, name resolution
    checker/
      types/ declarations/ expressions/ statements/              type model and per-construct rules
      inference/ overloads/ traits/ patterns/ rules/             cross-cutting engines and semantic rules
    lowering/           typed tree → Definition (all desugaring lives here)
    compile.ts          pipeline coordinator and public compiler API
  definition/           contract: versioned, JSON-serializable program definition (IR)
  runtime/
    values/ interpreter/ scheduler/ handles/ disposal/ snapshot/ boundary/
    host.ts             public host API: createRuntime(seams)
  stdlib/               resolver.ts for std paths; prelude/ and one folder per std module: <module>.ista + natives.ts
  formatter/            SyntaxTree → text; one printer per construct
  language-service/     editor-agnostic queries over Program snapshots; one folder per feature
  lsp/                  LSP adapter (vscode-languageserver): server.ts root, one provider per feature
  test-runner/          discover @Suite functions, run each test in a fresh in-memory instance
  packages/             ista.json, minimal version selection, lockfile, vendor, verify, vendor resolver
  cli/                  main.ts root, one module per command
test/corpus/            shared .ista corpus (spec examples, valid/invalid cases) used by every phase
```

## Layers

Imports point only downward; cycles are forbidden. Both rules are enforced by lint, not left to review.

```
cli · lsp · test-runner                 apps (composition roots); nothing imports them
language-service · formatter · packages tooling
compiler/compile ─▶ lowering ─▶ checker ─▶ binder ─▶ program ─▶ parser · scanner ─▶ syntax
runtime ─▶ definition ◀─ lowering       runtime never imports compiler/
stdlib natives ─▶ runtime native seam
text · diagnostics                      foundation
```

- A phase or feature folder is used only through its entry module, which is named for what it does (`scanner/scan.ts`, `parser/parse.ts`). Nothing reaches into another folder's internals. The foundation folders (`text/`, `diagnostics/`) are small vocabularies, used module by module.
- `syntax/` and `definition/` are contracts with high fan-in. Change them deliberately, and update every caller in the same change.
- Mechanisms:
  - Biome `noExcessiveLinesPerFile` enforces the 400-line limit.
  - Biome `noImportCycles` (project domain) forbids cycles.
  - dependency-cruiser enforces the layers as an allow-list over resolved paths (`.dependency-cruiser.mjs`). A layer not listed there can import nothing. Biome's import rules match specifiers, whose shape depends on directory depth, so they can't state an allow-list.

## Phase contracts

| Phase | Signature | Invariants |
| --- | --- | --- |
| scan | `scan(source) → { tokens, comments, diagnostics }` | Context-free, total and lossless: never throws, and every character belongs to exactly one token, comment or whitespace run (a leading byte order mark counts as whitespace). It emits no INDENT/DEDENT. Tokens carry `firstOnLine`, and columns come from `LineMap`. The result type `ScanResult` lives in `syntax/`, so the parser depends on the contract, not on the scanner. |
| parse | `parse(source, scanned) → SyntaxTree` | Total: always returns a full tree, with errors as `Missing`/`Invalid` nodes plus diagnostics. It owns layout (indentation blocks, newline-insensitive brackets, `{` as block vs struct literal vs field list), because layout depends on syntactic context. |
| tree | immutable plain objects, discriminated by `kind`, with a `span` | No parent pointers; parents are derived on demand. Child traversal is derived generically from node fields, never hand-listed per kind. A node field is therefore a node, a node array, an optional node, or a primitive. Nodes hold no tokens and no resolved references; the binder and checker keep those in side tables. |
| program | `Program { modules: Map<ModuleId, SyntaxTree>, imports, diagnostics }` | Immutable. An edit makes a new snapshot that reuses unchanged trees. |
| bind | `bindModule(tree)` (local; cached per tree), `link(program)` (imports) | Top-level declarations come in any order. Names starting with `_` are private. The prelude is implicit. |
| check | `createChecker(program)` → memoized queries: `typeOf`, `resolvedCall`, `symbolAt`, `diagnostics(module)` | Lazy, so the LSP pays only for what it asks. The CLI asks for everything. Binding happens inside: the checker calls the cached `bindModule` and `link`. |
| lower | `lower(checked) → Definition` | Runs only on an error-free program. The Definition is complete: no unresolved names, no sugar, and every call targets a function-table entry. |

Sugar is split by whether it has typing consequences:
- **Resolved in the checker** (it affects types or diagnostics): default parameters become overloads (and a clash is an error); `T?` is `Optional<T>`; operators, `$`, indexing, `for` and `T(x)` become resolved function calls; compound index assignment requires a `let`; closure captures become `Shared` values.
- **Done mechanically in lowering**, following the checker's decisions: overload bodies, capture structs, `defer` guards, `?.`/`??`/`is` as `match`, comprehensions as loops.

Each phase returns its diagnostics as values; there is no global sink. Codes are unique, with one catalog per phase.

## Seams and composition

A seam is an interface owned by its consumer. Each app's composition root picks the implementations; no module constructs its own collaborators.

| Seam | Owner | Implementations |
| --- | --- | --- |
| `SourceHost` | program | node fs (cli), open-document overlay (lsp), in-memory (tests) |
| `ModuleResolver` | program | relative paths (program), std (stdlib), vendored packages (packages); composed in order |
| `InstanceStore` | runtime | in-memory (tests, `ista run`) or host-provided persistence. It keeps each Definition once, by content hash, and an instance references that hash for its whole life. Definitions and snapshots both carry a format version; in v0.1 the runtime refuses any version it doesn't know. |
| `Natives` (extern bindings by module-qualified name) | runtime | stdlib natives, host externs (`ista run --host <module>` loads a module that exports a table), test mocks |
| `Timers` | runtime | host scheduling that wakes persisted instances when `time.at` is due. Tests fake time only through `mock(time.at, …)` (§10), not through this seam. |
| `Logger` | runtime | host-provided; the `log` std module routes to it |

## Registries

An open set of handlers is an explicit typed table, assembled in one module and made exhaustive by type (`satisfies Record<Kind, Handler>`). Adding a node kind therefore fails compilation until every phase handles it. Self-registration through import side effects is not used. Tables of this kind:

- parser: prefix and infix parselets by token kind; statements and declarations by leading keyword
- checker, lowering, formatter, interpreter: one handler per node kind
- LSP providers, CLI commands, std natives, diagnostic catalogs

## State: derive, never mirror

Every analysis result is a memoized function of immutable inputs: text → tokens → tree → Program → bindings → types. Caches are keyed by the input object (a `WeakMap`), so a new snapshot is a new key and nothing is ever invalidated by hand. The LSP holds only document texts and derives everything else. The runtime's only state is the instance snapshot.

## Decisions

- **Hand-written scanner and parser** (Pyright/TypeScript style). Rejected:
  - Langium: its indentation lexer can't turn layout back on for a `{}` block inside `(…)`, and Typir has no generics.
  - Chevrotain, Lezer, tree-sitter: they give untyped CSTs, and context-dependent `{` and generic-call speculation would fight the grammar.
- **No DI container.** Explicit composition roots plus registries keep wiring visible and type-checked.
- **Positions are UTF-16 offsets**, the LSP default. They are converted only at the edges.
- **Formatter layout algorithm comes from a library** (a Wadler-style doc printer such as Prettier's). Which one is decided at the formatter milestone.
- **Runtime keeps frames as data.** It is an explicit-stack interpreter over the Definition, so any `await` can be persisted (spec §5). The Definition is the lowered, resolved syntax tree that spec §5 says the interpreter executes. Values use `bigint` for `int`, `decimal.js` for `Decimal`, `re2js` for `regex` and `lossless-json` at the boundary.
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
