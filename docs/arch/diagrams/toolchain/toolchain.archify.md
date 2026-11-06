# How is the Istalang toolchain built? {#istalang-toolchain}

Istalang is one layered package in which each phase is a memoized function of an immutable snapshot: **text → tokens → SyntaxTree → Program → Bindings → Checker → Definition → instance snapshots**.

- `compile.ts` alone knows the phase order; each phase knows only its own input and output.[](source:compile)
- Imports point only downward, and dependency-cruiser enforces every layer as an allow-list.[](source:cruiser)
- Every open set of handlers is a `Handlers` table, exhaustive by node or instruction kind.[](source:kindtable)
- I/O happens only behind seams the consumer owns: `ModuleLoader`, `InstanceStore`, `Natives`, `now` and `seed`.[](source:host)

@answer scope="Implementation, not the language spec · worktree p4-computed at 5403091 · 2026-11-05"
@meta locale=en
@source compile title="Phase coordinator" path=src/compiler/compile.ts lines=38:88
@source cruiser title="Layer allow-list" path=.dependency-cruiser.mjs lines=116:166
@source kindtable title="Exhaustive kind tables" path=src/structures/kind-table.ts lines=1:37
@source program title="buildProgram: load, scan, parse, resolve imports" path=src/compiler/program/program.ts lines=133:153
@source bind title="bindProgram and per-module binding" path=src/compiler/binder/module/bind-module.ts lines=40:54
@source link title="Linker: imports, prelude, overloads" path=src/compiler/binder/link/index.ts lines=65:105
@source lower title="lower: start entries and the worklist" path=src/compiler/lowering/lower.ts lines=46:92
@source host title="Runtime host API and seams" path=src/runtime/host/index.ts lines=129:200
@source wake title="advance: segment, commit, repeat" path=src/runtime/scheduler/wake.ts lines=117:166
@source run title="ista run" path=src/cli/commands/run.ts lines=116:140
@source memo title="memo over immutable inputs" path=src/structures/memo.ts lines=1:50
@source workspace title="Language-service workspace" path=src/language-service/workspace.ts lines=1:40

## Which layers exist, and which way do imports point? {#layers}

Each arrow means "imports". The highlighted chain is the compiler's spine, which `compile.ts` drives. Nothing imports an app, and the runtime never imports `compiler/`. `text`, `diagnostics`, `language` and `structures` sit beneath every box and are left out.

@diagram architecture id=layer-map source=layer-map.architecture.json title="Layers and import direction"

| Rule | How it is enforced |
| --- | --- |
| A phase is used only through its entry module (`scan.ts`, `parse.ts`, `check.ts`) | dependency-cruiser allow-list |
| No import cycles, type-only imports included | Biome `noImportCycles` |
| 400 lines per file at most | Biome `noExcessiveLinesPerFile` |
| Node built-ins only in `cli/`, `lsp/`, `vscode-client/` and `project/` | dependency-cruiser |
| `syntax/` and `definition/` are contracts with high fan-in | changed with every caller in one commit |

Two arrows are left out to keep the map readable. `formatter` imports only `syntax`, and `lsp` uses it for formatting. `stdlib` also implements `program`'s `ModuleLoader` seam. The apps import more than the arrows show: `cli` imports `project`, `formatter` and the std natives; `language-service` reads `program`, `binder` and `syntax` directly too.

## What does each phase take and give? {#pipeline}

@workflow id=phase-pipeline title="From source text to a running instance"
| lane load | Load (program/) |
| lane analyse | Analyse |
| lane emit | Emit |
| lane run | Run (runtime/) |
| scan | scan | backend | load |
| parse | parse | backend | load |
| build | buildProgram | backend | load |
| bind | bindProgram | backend | analyse |
| check | checkProgram | backend | analyse |
| lower | lower | backend | emit |
| def | Definition | database | emit |
| deploy | deploy | backend | run |
| advance | start / wake | backend | run |
| scan > parse | tokens |
| parse > build | SyntaxTree |
| build > bind | Program |
| bind > check | Bindings |
| check > lower | Checker | emphasis |
| lower > def | entries |
| def > deploy | JSON text |
| deploy > advance | hash |

@steps id=pipeline-steps
| st-scan | scan | Context-free, total and lossless: every character is in exactly one token, comment or whitespace run. | phase-pipeline | scan |
| st-parse | parse | Hand-written and total: errors become `Missing` and `Invalid` nodes. Given the previous tree, it keeps the nodes of every unchanged segment. | phase-pipeline | parse |
| st-build | buildProgram | Walks imports breadth-first through the `ModuleLoader` seam, reads each module once, and reuses each tree whose text is unchanged. | phase-pipeline | build |
| st-bind | bindProgram | Binds each module alone, memoized on its tree, then links imports, the prelude and overload sets once per Program. | phase-pipeline | bind |
| st-check | checkProgram | One lazy, incremental checker per Program. Bodies are checked only when diagnostics, lowering or inference ask. | phase-pipeline | check |
| st-lower | lower | A worklist from `main` and every startable function; generics are compiled once per instantiation. | phase-pipeline | lower |
| st-def | Definition | Flat tables referring by index: modules, types, functions, constants and linear register code. | phase-pipeline | def |
| st-deploy | deploy | Validates the text, binds each extern to a native, and stores it by content hash. | phase-pipeline | deploy |
| st-advance | start / wake | Runs segment after segment; every `await` of the driver ends a segment, which commits a snapshot. | phase-pipeline | advance |

| Phase | Entry | Output | Memoized on |
| --- | --- | --- | --- |
| scan | `scan(source)` | tokens, comments, diagnostics | — |
| parse | `parse(source, scanned, previous?)` | `SyntaxTree` with anchored spans | segments of the previous tree |
| program | `buildProgram({ roots, loaders, roles }, previous?)` | `Program`: module graph snapshot | unchanged trees, by identity |
| bind | `bindProgram(program)` | `Bindings`: entities and queries | tree (module), Program (link) |
| check | `checkProgram(program, { previous })` | `Checker` and its `CheckedBody`s | Program; entries for reuse |
| lower | `lower(checker, main)` | `Definition` | — (runs on error-free programs) |
| run | `createRuntime(seams).deploy(text).start(name)` | `Advanced { state, spawned, logs }` | the instance snapshot in the store |

## What happens on `ista run main.ista`? {#run-sequence}

@sequence id=run-flow title="ista run: load, check, lower, deploy, advance"
| actor cli | ista run | frontend |
| actor project | project | backend |
| actor compile | compile.ts | backend |
| actor checker | checker | backend |
| actor lowering | lowering | backend |
| actor runtime | runtime host | backend |
| actor store | InstanceStore | database |
| phase | Load and diagnose |
| cli | project | loadProject(cwd, entry) |
| project | cli | Program | return |
| cli | compile | diagnose(program) |
| compile | checker | diagnosticsOf(module) |
| checker | compile | sorted diagnostics | return |
| phase | Compile |
| cli | compile | compileProgram(program, root) |
| compile | lowering | lower(checker, main) |
| lowering | checker | bodyOf(fn) per instance |
| checker | lowering | CheckedBody | return |
| lowering | compile | Definition | return |
| compile | cli | compiled | return |
| phase | Run |
| cli | runtime | deploy(definition text) |
| runtime | store | write Definition by hash |
| cli | runtime | start(name) |
| runtime | store | commit snapshot per segment |
| runtime | cli | Advanced state | return |
| cli | runtime | settle: wake when due | emphasis |

The CLI picks every implementation at its composition root: `memoryStore` or `directoryStore`, `stdNatives`, the host module of `--host`, the clock and a random seed.[](source:run) A failed compile stops after `diagnose`, because `compile` refuses any program with an error.

## How does the runtime run a Definition? {#runtime}

@diagram architecture id=runtime-map source=runtime-map.architecture.json title="Runtime parts"

- A frame is data: a function index, a pc and registers, so any `await` can be persisted.
- A segment restores the last commit, resolves due timers and watches, runs, then commits; a panic commits nothing.[](source:wake)
- The runtime holds no timers. A waiting state names the next due time, and the host wakes it then.
- `crashEveryAwait` runs each segment twice from one snapshot and panics if the runs differ.

## Where are the registries and seams? {#registries}

| Registry | Key | Lives in |
| --- | --- | --- |
| Parser parselets | token kind or leading word | `parser/grammar/word-parselets.ts`, `parser/grammar/expressions/` |
| Operators | operator text: level, associativity, meaning | `syntax/expressions/operators.ts` |
| Binder handlers | node kind | `binder/constructs/`: `declarations.ts`, `expressions.ts`, `statements.ts`, `patterns.ts`, `types.ts` |
| Checker handlers | node kind (six tables) | `checker/constructs/expressions/expressions.ts`, `statements/`, `declarations/`, `types/written/resolve-type.ts` |
| Flow constructs | node kind | `checker/rules/flow/forward.ts` |
| Lowering handlers | node kind | `lowering/constructs/expressions/expressions.ts`, `lowering/constructs/statements/statements.ts` |
| Interpreter | instruction kind | `runtime/interpreter/instructions.ts` |
| Completion | place kind and subject kind | `language-service/completion/` |
| LSP providers, CLI commands, std natives | request, command, extern key | `lsp/providers/`, `cli/commands/`, `stdlib/natives.ts` |

| Seam | Owner | Implementations |
| --- | --- | --- |
| `ModuleLoader` | program | project files, std modules (embedded sources), test loaders |
| `ProgramLoader` | language-service | the LSP's project loader with open documents over files |
| `InstanceStore` | runtime | memory, directory (atomic rename), host persistence |
| `Natives` | runtime | std natives, host externs adapted from JSON, test mocks |
| `now`, `seed` | runtime | the host clock and entropy |

@callout level=note title="Derive, never mirror"
Every result is memoized on the immutable object it derives from, through `memo` over a `WeakMap`.[](source:memo) A new snapshot is a new key, so nothing is invalidated by hand. The language server holds only document texts and derives the rest.[](source:workspace)
