---
description: the Definition (compiled program) and snapshot formats — instruction set, frames, values, externs, the decisions behind them, and how every spec construct lowers; read before changing lowering, the interpreter, or anything persisted
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-24
tags: [definition, ir, snapshot, runtime, lowering]
---

# Definition and snapshot

A **Definition** is the whole compiled program: flat tables of modules, types, functions and constants that refer to each other by index (`src/definition/`). A **snapshot** is a committed instance: its heap, its executions with their frames, and what determinism needs (`src/runtime/snapshot/`).

Both are persisted for an instance's whole life. Each is one zod schema that validates, decodes and encodes. The texts are canonical JSON with a version envelope, and the content hash keys storage.

## Decisions

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| How code is shaped | **Linear register code**: each function is a list of instructions over numbered registers. A frame is `(function, pc, registers)`. | A tree with an explicit continuation stack. Every node evaluator would have to resume midway, and the continuation's shape would have to be persisted. |
| Types in the code | **Untyped instructions.** Operators, indexing, `$`, `for` and `T(x)` are calls the checker already resolved. Types are stored only where a value's shape is needed without code: field names and annotations, extern signatures for the host boundary, extern types. | A typed IR, which would mean a second type system for the runtime to keep consistent with the checker's. |
| Generics | **Compiled per instantiation** (spec §3.5). Every call has one target, and a type table entry is fully concrete. | Passing type descriptors at runtime. That needs runtime dispatch for trait calls, which spec §3.10 rules out. |
| Calls | **One function table.** An extern is a table entry whose body names a native, so there is one call path, one place `mock` replaces a function, and one place extern results are seen. | Separate extern tables, which would mean two call paths and two mock points. |
| JSON | **lossless-json** (exact integers at any size) **with sorted keys**, read and written through **zod** codecs. In memory an `int` is a `bigint` and a float a `number`; on disk a float is tagged. | Native `JSON` with `rawJSON` and the reviver's source access: TypeScript 7 has no types for them. A hand-rolled canonicalizer. |
| What a snapshot stores | Only what can't be derived. Holder counts are recounted on restore, creation order is id order, and what an execution waits on is read from its pc. | Persisted counts, which could disagree with the values they count. |

## Frames

An execution is a stack of frames. A frame's registers are laid out as parameters, then a closure's captures, then locals and temporaries.

- **`cells`** lists registers that hold a shared cell, a variable passed by `&` or a `let` a closure captured (spec §3.14), each with the `Shared<T>` type entry the cell is created as, so its disposability is known. Reads and writes go through the cell, and a cell outlives its block while a call or closure still holds it (spec §3.7).
- **A reference parameter's register** holds a reference: a cell plus a path. References exist only in registers.
- **`kept`** collects what `keep` moved there: `fn let`, `fn const` and `fn _` holdings, which last until the function returns even from a loop body.
- **A stopped execution's pc** is always its `await` or `select`: the only instructions that wait, and the commit points (spec §5). A non-blocking `select` never waits.
- **A caller frame's pc** points at the `call` it made. On return, the runtime writes the result to that `call`'s `dst` and continues at the next instruction.
- **Resuming** an `await` writes the value to its `dst` and continues at the next instruction. Resuming a `select` releases the losing cases' holdings, writes the winner's `bind`, and continues at the winner's `target`.

Loading refuses code the interpreter couldn't run, so no instruction handler needs its own guard:
- an index outside its table
- a call or `spawn` whose arguments don't match the callee's parameters in number, or in value versus `&`
- a direct call to a function with captures (it is called through its closure value), and a `spawn` of an extern or of a function with captures or `&` parameters
- a closure that doesn't carry its function's captures
- a place whose element steps don't name an `index` taking a container and a key, and a `setIndex` taking `&`container, key and value
- code that doesn't end in `return`, `jump`, `branch`, `switch` or `select`
- waiting (`await`, a `select` without `otherwise`, `currentCall`) outside an async function

Release points are explicit. `release` runs at a block's end on every exit path, at a statement's end for temporaries, and for `drop`. `return` releases every register and the kept list. Whatever loses its last holder is disposed in reverse creation order (spec §7).

## Places

A place is a register plus a path of steps: a field, or an element. An element step carries the key register and the `index`/`setIndex` functions the checker resolved for the container, so `&m["a"]` and `a[k].b = v` work for built-in and user containers alike (spec §3.7). `store` writes a place with a non-empty path; writing an element replaces it through `setIndex`, atomically within the segment.

## Values

| In memory | On disk |
| --- | --- |
| `null` (unit), boolean, string | the same |
| `bigint` (`int`) | a JSON integer |
| `number` (`float`) | `{kind: 'float', value}`; NaN, ±Infinity and -0 as strings |
| tuple, struct, variant, array, map, closure | `{kind, …}` with child values; structs and variants by type index, fields in declaration order |
| extern value | `{kind: 'extern', type, payload}`; the payload is opaque |
| handle | `{kind: 'handle', object}`; never in a constant |

Map entries keep the runtime's order, so a restore iterates the same way.

## Externs

An extern entry has its own shape: no frame, no captures and no `async` (it returns a future instead), and parameters with their types, by value or by `&` as declared: the prelude's `push`, `pop` and `setIndex` take their container by `&`. Its `key` binds it to a native: the module, the name and the declared parameter types as written, `time.at(Time)` or `prelude.push(&Array<T>, T)`. Overloads therefore get distinct keys, and every instantiation of a generic extern shares one native. The entry also carries the instantiation's parameter and result types (used by the boundary conversion) and its type arguments (for natives such as `json.parse<T>`). An extern constant is an entry with `constant` set: it is read once per instance, then pinned in the snapshot's `externReads` by its function index (spec §3.6).

## Types and locations

A type entry is identified by its module-qualified declared `name` and its `arguments`, `time.Time` or `prelude.Optional` with `[int]`, so the runtime recognizes the types the boundary treats specially (spec §9) whatever their instantiation. An anonymous struct has no name.

Only extern types can be disposable (spec §7), and each entry's `disposal` says how: `none`; `runtime`, for futures, slots and revertible messages; or a `function`, the declared `dispose`, as for `Shared<Lease>`.

Each module carries its line starts. The runtime has neither source text nor the compiler, yet it turns spans into locations for `Error.trace`, a panic's trace, `waitingAt()` and the operator's view.

## Time

`now()` returns the time its segment started (spec §5). A panicked instance's snapshot records when the failed segment started, so an operator's retry sees the same time.

## Snapshot

- Status: `active`, `panicked` (message, trace, segment start) or `finished` (outcome).
- Objects, in ascending id order: `cell` (typed: every cell is a `Shared<T>`), `slot` (value when full, waiting futures oldest first), `future` (resolved, or pending on a call, slot operation, timer, host, `disposed()` or `disposing()`), `weakRef`, `guard` (`defer`), `resource` (a disposable runtime or host value, such as `Revertible<T>`), `mock`, `execution`.
- `ready`: executions in the order they became ready.

Disposability comes from an object's kind or type. Slots, futures, guards, mocks and executions are disposed by the runtime. A cell or resource follows its type entry's `disposal`, so a restore knows which cells have a `dispose` to call. A `mock` records each call's arguments for `m.calls()`.

The slot, future and resource parts were designed against spec §6–§8 before any of them runs. Changes go through the tech-lead.

## How each construct lowers

Instruction names are in `code`. A call is always to a function-table entry; for primitives that entry is a prelude extern.

| Construct (spec) | Lowered to |
| --- | --- |
| `struct` declaration, indented or one-line (§3.1) | a `struct` type entry per instantiation, fields in declaration order |
| Anonymous struct type, `struct { … }`, an indented field block (§3.1) | a `struct` type entry of its own; two anonymous structs are never the same entry |
| Recursive types (§3.1) | type references by index, so a type can name itself through the table |
| `enum` declaration, `T?`, `Result`, `Error` (§3.11, §3.12) | an `enum` type entry per instantiation; `Error` is a `struct` entry |
| `extern struct`, `extern sendable struct` (§3.6, §3.8) | an `extern` type entry per instantiation, with `sendable` and `disposal` (§7) |
| Traits, `T is A & B`, `Sendable`, `Disposable` as constraints (§3.5, §3.10) | nothing at runtime: the checker resolves every constrained call per instantiation |
| Value semantics and handle identity (§3.1) | `move` copies values; handles compare by object id in `equal` |
| `@JsonName`, `@JsonSkip` (§3.16, §9) | `annotations` on the field's type entry, read by the boundary conversion and `json` |
| Literals: int, float, string, bool, `none`, durations (§2) | `constant`; a duration is a `time.Duration` struct constant, `none` an `Optional` variant |
| Array literal and spread (§2) | `array` with item and spread elements |
| Map literal (§2) | `map` for a `Map`; for another `IndexAssignable`+`Default` type, a call to `default`, then a `store` per entry |
| Tuple, `()` (§3.15) | `tuple`; `()` is the unit constant |
| Range `a..b`, `a..=b`, open ends (§2, §3.8) | `struct` of prelude `Range`; `..=` calls `add` to store `end + 1` |
| Struct literal: named, shorthand, positional, `struct{…}` (§3.1) | `struct`, fields in declaration order |
| Updated copy `T{...r, f: v}` (§3.1) | `field` for each field not given, then `struct` |
| Enum variant (§3.11) | `variant`; a variant without fields may be a constant |
| Implicit wrap of `T` into `T?` (§2) | `variant` `Some` |
| `fn`, `async fn`, methods, static functions (§3.3, §3.7) | function-table entries; a method's `self` is its first parameter |
| Overloads (§3.7) | distinct entries; calls name one |
| Default parameters (§3.3) | generated entries that evaluate the defaults and call the full function |
| Rest parameter (§3.3) | the caller builds an `array` |
| `return`, last expression (§3.3) | `return` |
| `extern fn`, extern constant (§3.6) | `extern` function entries; reading a constant is a `call` |
| `let`, `const`, assignment (§3.4) | registers; `move` or a write through a cell |
| Block end, `break`, `continue` (§3.4, §4) | `release` of the block's registers, then `jump` where needed |
| `fn let`, `fn const`, `fn _` (§3.4) | `keep`, then `release`, at the block's end |
| `_ = e` (§7) | an unnamed register, released at the block's end |
| `drop e` (§7) | `release` |
| Destructuring `a, b = t` (§3.15) | `field` per element |
| Generic functions and types (§3.5) | one entry or type per instantiation |
| `&x` argument, reference parameter (§3.7) | a place argument; `parameters[i].reference`; `x` is in `cells` |
| `Shared(v)`, `x$`, `x$ = v`, `x$.f = v` (§3.8, §3.9) | calls to `Shared.from`, `unwrap` and `rewrap`; a field write unwraps, `store`s into a temporary and rewraps |
| Operators (§3.9) | a `call` to the resolved function |
| `<`, `<=`, `>`, `>=` (§3.9) | a `compare` call, then `order` |
| `==`, `!=` (§3.9) | `equal`, plus `not` for `!=` |
| `not`, `and`, `or` (§3.9) | `not`; `branch` (short-circuit) |
| `x[k]`, slicing (§3.9) | a call to the resolved `index` |
| `x[k] = v`, `a[k].b = v`, `x[k] += 1` (§3.9) | `store` to a place with element steps; compound forms call `index` and the operator first |
| `T(x)` (§3.10) | a call to `T.from` |
| Trait-constrained calls, `T.zero()` (§3.10) | resolved per instantiation; plain calls |
| `for x in c` (§3.10, §4) | a call to `iterate`, then a loop over `length` and `index` |
| `if`, `elif`, `else`, `while` (§4) | `branch` and `jump`; a branching expression writes a result register |
| Block expression (§4) | its statements, then `release` |
| Comprehension (§4) | a loop that calls `push` on an `array` |
| `match`, patterns, guards (§3.11, §4) | `switch` on the variant, then `field` and `move` for bindings, `equal` or `compare` for comparisons, `branch` for guards |
| `x is P` (§3.11) | the same tests, producing a boolean |
| `?.`, `??` (§4) | `switch` on `Optional` |
| `e?` on `Result` (§3.12) | `switch` on `Result`; the `Err` path returns it |
| `panic(m)` (§3.12) | a call to prelude `panic` |
| Building an `Error` (§3.12) | `struct`, with `trace` from a call to a prelude extern that formats the current frames' spans through the modules' line starts |
| Imports, type aliases (§3.13, §3.17) | nothing at runtime; `modules` lists module ids for spans |
| Lambdas, local `fn`, closures (§3.14) | `closure` with captures; a captured `let` is a cell, a `const` a copy |
| Named lambda calling itself (§3.14) | `currentClosure` |
| Calling a function value (§3.14) | `call` with a value callee |
| Annotations (§3.16) | `annotations` on functions and fields; `@Waypoint` becomes the `waypoint` of an `await` or `select` |
| `await` (§5) | `await`, which commits first |
| `runtime.commit()` (§3.8) | a call to an already-resolved future, then `await` |
| Slots and their operations (§6) | calls to prelude externs that return futures |
| Inbox, `futures`, `rpc`, `fanout` (§3.8, §6) | library code over slots |
| `defer f` (§7) | `defer`, held in a register like any value |
| `WeakRef`, `disposed()` (§7) | calls to prelude externs |
| `worker.disposing()` (§7) | `currentCall` at the function's entry, then a call to `disposing` |
| `select`, `await select` (§8) | `select`; per case: the future, the registers it holds, `bind` for `as`, and the target; `otherwise` for the non-blocking form |
| Prelude and standard-library functions: `push`, `at`, `get`, `length`, … (§3.8) | calls to their entries; runtime-backed ones are externs |
| Versioning (§5) | an instance references its Definition's content hash for its whole life |
| Disposable cycles (§7) | nothing in the code; the runtime's snapshot pass finds and disposes them |
| `main` (§9) | `Definition.main` |
| Host starts an instance, operates a panicked one (§3.12, §9) | the runtime's host API over Definitions and snapshots; the snapshot's `status` records panics and outcomes |
| `spawn f(args)` (§9) | `spawn` |
| Values crossing the host boundary (§9) | driven by the extern entries' types and the type table |
| `@Suite`, `mock`, `testing.start`, `handle<T>()` (§10) | function annotations; natives over the function table and the host API |
| `crashEveryAwait` (§10) | a runtime option: every segment runs twice before it commits |
