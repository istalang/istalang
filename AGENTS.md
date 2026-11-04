# Istalang toolchain

Compiler, runtime and tooling for Istalang (spec: `docs/spec.md`). One npm package: ESM, TypeScript 7, Node ≥ 22.18.

## Commands

- `npm run verify`: typecheck, lint, test, build. Tests build `dist` first, because the CLI's end-to-end test runs it. Run it before every commit.
- `npm test`, `npm run lint`, `npm run fix` (format plus safe fixes).

## Where to look

- `docs/arch/architecture.md`: folders, layers, phase contracts, seams. Read it before adding a module or importing across folders.
- `docs/work/`: plans, phase details, `tracker.md`.
- `src/`: code, organized by toolchain feature (`src/AGENTS.md`).
- `test/`: inputs shared across phases (`test/AGENTS.md`).
- `.vscode/extensions/ista/`: VS Code highlighting for `.ista`, installed with *Developer: Install Extension from Location…*. `test/vscode-grammar.test.ts` holds its reserved words to the scanner's.

## Principles

- **Folders are by feature.** Inside a phase, they are by language construct.
- **400 lines per file at most.** A file that outgrows the limit becomes `name/index.ts`, which keeps the entry's real logic, with the extracted parts beside it.
- **No barrels or re-exports.** Import from the module that defines the thing.
- **Every file opens with a banner comment** giving the decisions and their reasons, never what the code already says. TSDoc on a function is 1–3 lines.
- **DRY.** Every rule has one home. Before hand-rolling a subsystem, search for a maintained library.
- **Coupling stays loose.** Phases talk through contracts (`compiler/syntax/`, later `definition/`). An open set of handlers is a typed table (`satisfies Record<Kind, Handler>`). Dependencies are passed in at composition roots, with no DI container and no import side effects.
- **Derive, never mirror.** Memoize derived data, keyed by its immutable input. Never store a copy and sync it.
- **Tests sit beside their code** as `*.test.ts`, with shared helpers in `*.test-kit.ts`. Prefer properties over generated, broken and hostile inputs (fast-check) to snapshots of one observed output.
- **Biome runs every stable rule as an error**, including the project, type-aware and test domains. Each exception in `biome.jsonc` states its reason. dependency-cruiser enforces the layers.
- Alway implement a **robust** approach, never a hacky solution to fix a specific case. If it can be written in a generic way to be used in other places too, do it and refactor those other places too.
- When different units-of-coe have incompatible APIs, your first try must be to **refactor and unify** them, not writing a new wrapper adding more code to maintain.
- Normalize at construction, in one place. When a value or type has a canonical form, its constructor enforces the whole invariant, and every path that produces one (resolution, substitution, deserialization) builds through that constructor.  If a layer boundary keeps the constructor from a rule it needs, pass the rule in through a seam — never split normalization between the constructor and a few callers.
 - Contracts carry semantics, never premature layout. A phase records what a construct means in its own types, never the physical offsets, steps or booleans a later phase will emit, especially across a transformation (such as generic instantiation) that can collapse or reshape cases. The later phase derives layout from the final, concrete shape; nothing patches a pre-baked layout after the fact.
 - One representation per meaning; no punning. Never overload one primitive, index or sentinel (0, undefined, a bottom type) to mean two different things ("field 0" vs. "unwrap wrapper", "unconstrained" vs. "constrained to bottom"). Give each meaning its own variant in the union so consumers dispatch on it instead of reconstructing how it got there.
 - Probes do not mutate. A check that tests whether a candidate, branch or conversion applies leaves no state behind when it fails. Never thread a stateful accumulator through a search or fallback chain unless failed probes roll back or non-speculative choices run first.
- **Commits are one line, Angular style** (`feat(scanner): …`), with no body and no attribution.
