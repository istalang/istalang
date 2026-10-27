---
description: the Definition (compiled program) and snapshot formats — instruction set, frames, values, externs, the decisions behind them, and how every spec construct lowers; read before changing lowering, the interpreter, or anything persisted
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-26
last_updated: 2026-10-27
tags: [definition, ir, snapshot, runtime, lowering]
---

# Definition and snapshot

A **Definition** is the whole compiled program: flat tables of modules, types, functions and constants that refer to each other by index (`src/definition/`). A **snapshot** is a committed instance: its heap, its executions with their frames, and what determinism needs (`src/runtime/snapshot/`).

Both are persisted for an instance's whole life. Each is one zod schema that validates, decodes and encodes. The texts are canonical JSON with a version envelope, and the content hash keys storage.

Both formats were written for the whole language before any of it compiled, so the feature slices code against one contract instead of each inventing its part. Lowering doesn't emit every instruction yet, and the runtime doesn't run every one: the instructions and load rules for constructs still behind the checker's frontier stand untested by real programs, exercised only by random and hand-written Definitions. The slice that first emits an instruction amends what using it shows to be wrong, through the tech-lead.

## Decisions

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| How code is shaped | **Linear register code**: each function is a list of instructions over numbered registers. A frame is `(function, pc, registers)`. | A tree with an explicit continuation stack. Every node evaluator would have to resume midway, and the continuation's shape would have to be persisted. |
| Types in the code | **Untyped instructions.** Operators, indexing, `for` and `T(x)` are calls the checker already resolved. Types are stored only where a value's shape is needed without code: field names and annotations, extern signatures for the host boundary, extern types. | A typed IR, which would mean a second type system for the runtime to keep consistent with the checker's. |
| Generics | **Compiled per instantiation** (spec §3.5). Every call has one target, and a type table entry is fully concrete. | Passing type descriptors at runtime. That needs runtime dispatch for trait calls, which spec §3.10 rules out. |
| Calls | **One function table.** An extern is a table entry whose body names a native, so there is one call path, where a mock the calling instance reaches replaces a function whatever it is (spec §10), and one place extern results are seen. | Separate extern tables, which would mean two call paths and two mock points. |
| JSON | **lossless-json** (exact integers at any size) **with sorted keys**, read and written through **zod** codecs. In memory an `int` is a `bigint` and a float a `number`; on disk a float is tagged. | Native `JSON` with `rawJSON` and the reviver's source access: TypeScript 7 has no types for them. A hand-rolled canonicalizer. |
| What a snapshot stores | Only what can't be derived. Nothing about holders is stored or counted: whether a value is still held is decided by reachability where something lets go of it (Holders). Creation order is id order, and what an execution waits on is read from its pc. | Reference counts, persisted or kept in memory: every copy and overwrite would have to update them, they could disagree with the values they count, and disposables holding each other in a cycle would never reach zero. |

## Frames

An execution is a stack of frames. A frame's registers are laid out as parameters, then a closure's captures, then locals and temporaries.

- **`cells`** lists registers that hold a shared cell, a variable passed by `&` or a `let` a closure captured (spec §3.14), each with the `_Cell<T>` type entry the cell is created as, so its disposability is known (a `_Cell` never is: only the prelude could declare its `dispose`). Reads and writes go through the cell, and a cell outlives its block while a call or closure still holds it (spec §3.7).
- **A reference parameter's register** holds a reference: a cell plus a path. References exist only in registers.
- **`kept`** collects what `keep` moved there: `fn let`, `fn const` and `fn _` holdings, which last until the function returns even from a loop body.
- **A stopped execution's pc** is always its `await` or `select`: the only instructions that wait, and the commit points (spec §5). A non-blocking `select` never waits.
- **A caller frame's pc** points at the `call` it made. On return, the runtime writes the result to that `call`'s `dst` and continues at the next instruction.
- **An async call** starts a new execution and its `call` future (spec §3.3); the execution names the future its return resolves (`resolves`), and the root, the one the instance started with, names none. The callee runs on top of its caller, in the caller's segment, until it awaits or returns; only then does the caller's `call` receive the future. Only an `await` or blocking `select` by the execution that began the segment ends it and commits, so when a commit happens every other execution stands at an `await` or `select`. Every wait commits, even on a future that has resolved, and the execution then runs after the executions that became ready before it (spec §6).
- **Resuming** an `await` writes the value to its `dst` and continues at the next instruction. Resuming a `select` releases the losing cases' holdings, writes the winner's `bind`, and continues at the winner's `target`.

Loading refuses code the interpreter couldn't run, so no instruction handler needs its own guard:
- an index outside its table
- a call or `spawn` whose arguments don't match the callee's parameters in number, or in value versus `&`
- a direct call to a function with captures (it is called through its closure value), and a `spawn` naming an extern or a function with captures or `&` parameters (a closure a `spawn` calls through its value is of a sendable function type, which the checker decided)
- a closure that doesn't carry its function's captures
- code that doesn't end in `return`, `jump`, `branch`, `switch` or `select`
- waiting (`await`, a `select` without `otherwise`, `currentCall`) outside an async function

Release points are explicit (spec §3.4, §7):
- `release` runs at a block's end on every exit path, for the variables it declared, with `keep` first for its `fn let`, `fn const` and `fn _` variables. `break` and `continue` end every block they leave the same way. A function's own body releases nothing, its `return` releasing every register and the kept list.
- A statement's end releases its temporaries: the registers it allocated that no variable lives in. A header's temporaries (an `if` or `while` condition, a `match` subject or guard) are released on every path out of the header, before the body.
- `drop x` is a `release` of `x`; a value given to `_` lives in a register of its block with no name, as does a `defer` guard, and the holdings of a `select`'s winning case.
- Each pass of a loop, each branch of an `if` and each `match` or `select` case is a scope of its own, so the bindings a pattern or a loop's targets make end with it.

Releasing empties registers, and whatever lost its last holder is disposed there (Holders).

A cell register is made a cell by its first write into the empty register, a local's at its declaration's run. A block-end `release` (§7) empties the register, so the next run of the declaration makes a fresh cell, as §3.4 asks of a variable declared in a loop body. A closure's capture of a cell holds the closure's cell as it was captured: making a closure (`closure`, `currentClosure`) captures a cell register's cell and any other register's value, and a call of the closure puts its captures after its parameters as they are, so both sides share the cell (spec §3.14). A live frame reads and writes a cell register, and a reference parameter's register, through the instance's cells, so `move`, `store` and a `call`'s result write the same whatever the register holds; the snapshot stores the register's handle or reference as it is. Lowering lists a variable in `cells` exactly when the checker found it passed by `&` (explicitly, as a method's `&self`, or to the `setIndex` writing one of its elements) or found it a `let` a closure captures; a capture of one is listed in the capturing function's `cells` too, and so is a register an element is copied into when it is passed on by `&` (Places). A parameter is never a cell: a by-value one is immutable (spec §3.3), and a reference parameter already holds a reference. A native taking `&` receives the value, and writes the changed one back through its context (see Externs).

## Holders

Whether a value is held is decided by reachability, never counted (spec §7). The roots are every live execution's frames: their registers, the cells their references name, and their kept lists. The objects held through them are found by what each object holds:

| Object | Holds | Watches without holding |
| --- | --- | --- |
| cell | its value | |
| slot | its value | its queue of waiting operations |
| future | a resolved one its value; a pending `put` its value and slot; a pending `take` or `read` its slot; a `first` the futures it races; a `disposed()` or `disposing()` watch its weak reference | |
| guard, mock | the function value they call (a mock also its recorded calls) | |
| answer | the future it waits on | |
| weakRef | | its target: a disposable, or a call's execution |
| execution | (a root while it lives) | its own call future, which its caller holds |

An answer (§10) is a root too, until it is given: another instance waits on it.

An execution running on the run stack holds its own call future too, until it suspends. An object is disposed when nothing holds it only when its disposal can be seen: it stops a call, drops a wait from its slot's queue, frees a host's token, runs code, or resolves the watches of a weak reference to it. Any other (a resolved future, a timer, a `first`, a slot no weak reference refers to) is left out of the next commit, as a plain value is; what it held is let go of all the same. After an instruction that let go of something (a register overwritten or emptied, a frame ended, an object changed or removed), the runtime finds the disposables what was let go of reaches and walks from the roots until it has found them all held; only when one isn't does it collect. What nothing holds is disposed newest first, except that an object another unheld disposable holds, even through a plain cell, waits until that one's disposal is done; disposables holding each other in a cycle are disposed together. A disposal that runs code (a `defer` guard's function, a declared `dispose`) is a call on the run stack, made before the instruction's execution goes on. Disposing a call's future disposes the call: its `disposing()` watches resolve, and if it waits on one of them it resumes there on the run stack, that case winning whatever else resolved, and stops at its next `await` or return; otherwise it stops where it waits (spec §7).

A referent has one `weakRef`, so `WeakRef(a) == WeakRef(a)`. Once a disposed object is gone, after any code its disposal ran, its weak reference loses its target and the watches on it resolve, so a woken watcher's `deref()` gives `none` (spec §6). `currentCall` gives the weak reference to the running call's execution; when the call returns, it loses its target without resolving anything, so its `disposing()` never resolves, and a closure that watches a call it was made in captures that handle. A commit persists the executions and what they hold, found in one walk that also finds the deepest value's depth (Values).

## Places

A place is a register plus a path of field positions. A tuple element is a field by position, as `field` reads it. `store` writes a place with a non-empty path, and a `&` argument passes one; following a path never runs code.

An indexed element is no step of a place, so every call a program makes is a `call` instruction, run on the scheduler's run stack. An element is reached through an accessor: read with the `index` the checker resolved for its container, written with `setIndex(&container, key, element)` (spec §3.7, §3.9). A place's handle and keys are computed once, in source order, when it is entered; a part behind an accessor is then read, and written, as the accessor's value stands at that moment. Writing it reads that value into a register of its own, stores the part, and writes it back, at each accessor from the innermost out, so a change made to another part between a compound assignment's read and its write stays. `a[i].b = v` is therefore `index`, a `store` to the read value, then `setIndex`; `a[i][j] = v` reads `a[i]` into a cell, which the inner `setIndex` takes by `&`, then writes it back; and `f(&m[k])` copies `m[k]` into a cell, calls `f`, then writes the cell's value back the same way. A write that ends at an element is a `setIndex` alone, never reading the element first, since a map may not hold the key yet. The value behind a handle (`*x`) is reached the same way, with `readCell` and `writeCell`, and a write of the whole value is a `writeCell` alone. The container a `setIndex` takes by `&` is a cell: the checker records a variable whose element is written as passed by `&`, as `x.push(v)` passing `&x` is.

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

A persisted value nests at most `maximumDepth` (256) levels (spec §5), since the JSON and zod codecs recurse on the host's stack; a format refuses a body deeper than any valid one before either codec runs. Walks over values in memory (`==`, map keys, handles, depth) keep stacks of their own, so a deeper value lives within a segment, and the runtime panics a segment that would commit one.

The built-in `==` and map keys are `language/values.ts`'s rules, shown the runtime's values by `definition/equality.ts` and compile time's constant forms by the checker, so the two can't disagree.

Values are immutable. A `constant` instruction hands its register the pool's own value, and a bound program, its pool included, is shared by every instance a runtime runs, so nothing may write into a value in place: a write through a place (`store`, `setIndex`) builds the new value along its path, as value semantics (spec §3.1) has it anyway.

## Externs

An extern entry has its own shape: no frame, no captures and no `async` (it returns a future instead), and parameters with their types, by value or by `&` as declared: the prelude's `push`, `pop`, `delete` and `setIndex` take their container by `&`. A native receives such an argument's value, and writes the changed value back through its context, which writes it to the place the `&` names. Its `key` binds it to a native: the declaring module's canonical name, the declared name, and the declared parameter types, `time.at(time.Time)` or `prelude.push(&prelude.Array<T>, T)`. Every named type in a key is module-qualified and written without sugar (`prelude.Optional<int>`, never `int?`), so two modules' types never share a key. An anonymous struct in a key is spelled by its fields, `struct { a: int; b: string }`, since it has nothing else. `externKey` (`definition/extern-key.ts`) is the only place a key is spelled: lowering and every natives table build keys through it. Overloads therefore get distinct keys, and every instantiation of a generic extern shares one native. The entry also carries the instantiation's parameter and result types (which natives build their results by) and its type arguments (for natives such as `json._decodeHandle<T>`). An extern constant is an entry with `constant` set: it is read once per instance and then pinned for the instance's life (spec §3.6), in the snapshot's `pinned`, by key.

An extern a host implements is called through a code entry, its wrapper, which encodes each argument as `Json`, calls the extern entry, and decodes what comes back; the extern entry's parameters and result are all `json.Json` (a `Future<json.Json>` for one returning a future), and it carries its `declaredType` (a function's result, a constant's type), which the runtime holds the host to across deploys. Reading a host's extern constant is a call to an entry that decodes its value the same way (docs/arch/boundary.md).

## Names

A function entry's `name` is for traces to read; entries are identified by index, and names may repeat. It is the declaration's name qualified by its module's canonical name (`time.delay`, `prelude.Slot.create`). An instance of a generic function spells its type arguments the way extern keys spell types, module-qualified and without sugar (`main.show<main.Money>`, `main.first<prelude.Optional<int>>`). An entry that computes the defaults a call leaves out (spec §3.3) appends `/` and how many arguments it takes (`main.retry/1`), and calls the entry taking them all. The entry giving a field its default (spec §3.1) is named after the struct or variant declaring the field, with `/` and how many fields before it it takes (`main.Retry/1`, `main.Circle/0`), and gives that field's value. A lambda or local function (spec §3.14) is an entry per instance of the top-level function holding it, named after that instance and its own name, or where a lambda stands: `main.makeCounter.next`, `main.run.lambda@12:9`.

## Types and locations

A type entry is identified by its module-qualified declared `name` and its `arguments`, `time.Time` or `prelude.Optional` with `[int]`, which traces and keys read; the runtime recognizes no type by its name, only by its `role` (below). An anonymous struct has no name.

Only extern entries can be disposable (spec §7), and each entry's `disposal` says how: `none`; `runtime`, for futures and slots; or a `function`, the entry of the declared `dispose`'s instance, called with a handle to the value, as for a shared struct `Lease`. Lowering takes it from the checker, which derives it from the `dispose` declared for the type: an extern `dispose` a std module declares beside its extern type, as the prelude does for `Future` and `Slot`, is the runtime's; a `dispose` a program declares, for a shared struct (spec §3.18) or a host's extern type, is a `function`. A host value of an extern type with `function` disposal, a cell's aside, is a `resource` object behind a handle, which the boundary makes as the value arrives from the host and unwraps to its payload as it leaves. No list of disposable types is kept anywhere.

An extern or enum entry's `role` says what the runtime makes of its values where its natives alone don't: `cell` for every shared struct (spec §3.18) and for `_Cell<T>`, the one a variable lives in (§3.7, §3.14): the type a cell must have, `future` for every `Future<T>`, which a host's extern returning one gives back pending, and `json` for the json module's `Json`, which the json natives and the host boundary read and write (`definition/json-values.ts`). Lowering sets it from the checker's entities, and any other type has none, so no runtime rule depends on how a std module spells a type's name.

Each module carries its line starts. The runtime has neither source text nor the compiler, yet it turns spans into locations for `Error.trace`, a panic's trace, `waitingAt()` and the operator's view.

## Time

`now()` returns the time its segment started (spec §5). A panicked instance's snapshot records when the failed segment started, so an operator's retry sees the same time.

## Snapshot

- Status: `unstarted` (the call a new instance runs: its function, a closure's captures and the arguments), `active`, `panicked` (message, trace, segment start, and what a retry runs again: the call, when it panicked before its first commit, or what its host filled, when it panicked in the segment the fill ran), `finished` (outcome) or `terminated` (by its operator). What a host is told about an instance is derived from this status alone. A name with `/` is the runtime's. A spawned instance is written `unstarted`, named `<parent>/<n>`, before its parent's commit; `spawned` counts the instances an instance has spawned, which numbers the next.
- `pinned`: each extern constant the instance read, by key, with the value it gave (spec §3.6).
- `crashEveryAwait`: the instance's option, set when it starts (spec §10), so every runtime that wakes it re-runs its segments.
- Objects, in ascending id order: `cell` (typed: a shared struct's or a `_Cell<T>`, an entry of the `cell` role), `slot` (value when full, waiting operations oldest first, one queue for every kind), `future` (resolved, or pending on a call, slot operation, timer, host, `futures.first` over other futures, or a weak reference's referent being disposed: `disposed()` and `disposing()`, or a watch on an instance a test started: `idle()`, `reaches(label)` and `result()`), `weakRef` (its target, until disposed or, for a call's, returned), `guard` (`defer`), `resource` (a host value of a disposable extern type), `mock` (its target, replacement and recorded calls), `answer` (a call another instance made to one of this instance's mocks: the future it waits on, and the caller's instance and future token it fills), `execution`.
- `ready`: executions in the order they became ready.

Disposability comes from an object's kind or type. Slots, futures, guards and mocks are disposed by the runtime, and an execution is stopped when its call future is. A cell or resource follows its type entry's `disposal`, so a restore knows which cells have a `dispose` to call. A `mock` records each call's arguments for `m.calls()`; the newest one held for a target is the one its calls reach, from this instance and from the instances it started or spawned, which are named after it (`<parent>/<n>`).

The slot, future and resource parts were designed against spec §6–§8 before any of them runs. Changes go through the tech-lead.

## How each construct lowers

Instruction names are in `code`. A call is always to a function-table entry; for primitives that entry is a prelude extern.

| Construct (spec) | Lowered to |
| --- | --- |
| `struct` declaration, indented or one-line (§3.1) | a `struct` type entry per instantiation, fields in declaration order |
| Anonymous struct type, `struct { … }`, an indented field block (§3.1) | a `struct` type entry of its own; two anonymous structs are never the same entry |
| Recursive types (§3.1) | type references by index, so a type can name itself through the table |
| `enum` declaration, `T?`, `Result`, `Error` (§3.11, §3.12) | an `enum` type entry per instantiation, with, for `json.Json`, its `role`; `Error` is a `struct` entry |
| `extern struct`, `extern sendable struct` (§3.6, §3.8) | an `extern` type entry per instantiation, with `sendable`, `disposal` (§7) and, for `Future`, its `role` |
| `shared struct X` (§3.18) | an `extern` type entry per instantiation, never sendable, with its `disposal` and the `cell` role; the value behind it is an anonymous struct entry of its fields |
| Traits, `T is A & B`, `Sendable`, `Disposable` as constraints (§3.5, §3.10) | nothing at runtime: the checker resolves every constrained call per instantiation |
| Value semantics and handle identity (§3.1) | `move` copies values; handles compare by object id in `equal` |
| `@JsonName`, `@JsonSkip`, `@JsonBigInt` (§3.16, §9) | `annotations` on the field's type entry, for tools; derived codecs are compiled from the checker's derived forms, which read them |
| Literals: int, float, string, bool, `none`, durations (§2) | `constant`; a duration is a `time.Duration` struct constant, `none` an `Optional` variant |
| Array literal and spread (§2) | `array` with item and spread elements; a spread of an array is a spread element, which copies it, and any other spread the loop `for` runs over its operand, each item appended with `array` to what the elements before it built |
| Map literal (§2) | `map` for a `Map`: a spread of a map is a spread entry, which copies its entries, and any other spread the loop `for` runs, each `(key, value)` item an entry added with `map` to what the entries before it built; for another `IndexAssignable`+`Default` type, a call to `default`, then a `setIndex` call per entry, and for a spread the loop `for` runs, with a `setIndex` call per item |
| Tuple, `()` (§3.15) | `tuple`; `()` is the unit constant |
| Range `a..b`, `a..=b`, open ends (§2, §3.8) | `struct` of prelude `Range`; `..=` calls `add` to store `end + 1` |
| Struct literal: named, shorthand, positional, `struct{…}` (§3.1) | `struct`, fields in declaration order; a field left to its default from a `call` to its default's entry, given the fields before it |
| Updated copy `T{...r, f: v}` (§3.1) | the spread value once, `field` for each field not given, then `struct` |
| Struct without fields, written bare (§3.1) | `struct` with no fields; a constant when it is one |
| Enum variant (§3.11) | `variant`; a variant without fields may be a constant |
| Implicit wrap of `T` into `T?` (§2) | `variant` `Some` |
| `fn`, `async fn`, methods, static functions (§3.3, §3.7) | function-table entries; a method's `self` is its first parameter |
| Overloads (§3.7) | distinct entries; calls name one |
| Default parameters (§3.3) | generated entries that evaluate the defaults and call the full function |
| Field defaults (§3.1) | a generated entry per field left to its default and instantiation, taking the fields before it and giving the default |
| Rest parameter (§3.3) | the caller builds an `array` |
| `return`, last expression (§3.3) | `return` |
| `extern fn`, extern constant (§3.6) | `extern` function entries; reading a constant is a `call`; a host's is called through its wrapper, which converts to and from `Json` (Externs) |
| `let`, `const`, assignment (§3.4) | registers; `move` or a write through a cell |
| Top-level `const` (§3) | computed while compiling into a constant; reading one is a `constant` instruction, like a literal; a lambda in one is a closure constant of no captures, its function an entry of its own |
| Block end, `break`, `continue` (§3.4, §4) | `release` of the block's registers, then `jump` where needed |
| Statement end, a header's end (§7) | `release` of the temporaries it left; a header's on every path out of it, before the body |
| `fn let`, `fn const`, `fn _` (§3.4) | `keep`, then `release`, at the block's end |
| `_ = e` (§7) | an unnamed register, released at the block's end |
| `drop x`, `drop e` (§7) | `release` of `x`; for an expression, its temporaries at the statement's end |
| Destructuring `a, b = t`, `const Pair{first} = p`, at any depth (§3.15) | the value once, then `field` reads along each target's path, and a `move` or `store` per target |
| Tuple element `t.0`, `t.0 = v` (§3.15) | `field` by position; `store` with a field step |
| Generic functions and types (§3.5) | one entry or type per instantiation |
| `&x` argument, reference parameter (§3.7) | a place argument; `parameters[i].reference`; `x` is in `cells`; `&m[k]` copies the element into a cell around the call (Places) |
| `new X{…}` (§3.18) | the fields' `struct`, then `newCell` with the shared struct's entry |
| `*x`, `*x = v`, `x->f = v`, `&x->f` (§3.7, §3.9) | `readCell` and `writeCell` on the handle's cell; a part write reads the value when it writes, stores the part and writes it back, and a `&` copies the part into a cell around its call (Places) |
| Operators (§3.9) | a `call` to the resolved function |
| `<`, `<=`, `>`, `>=` (§3.9) | a `compare` call, then `order` |
| `==`, `!=` (§3.9) | `equal`, plus `not` for `!=` |
| `not`, `and`, `or` (§3.9) | `not`; `branch` (short-circuit) |
| `x[k]`, slicing (§3.9) | a call to the resolved `index` |
| `x[k] = v`, `a[k].b = v`, `x[k] += 1` (§3.9) | a `setIndex` call taking the container by `&`; a deeper write reads each element with `index` when it writes and writes it back with `setIndex` (Places); compound forms call `index` and the operator first |
| `T(x)` (§3.10) | a call to `T.from` |
| Trait-constrained calls, `T.zero()` (§3.10) | resolved per instantiation; plain calls |
| `for x in c` (§3.10, §4) | a call to `iterate`, then a loop calling the cursor it gives, a function value, until a `switch` on what it gives finds `None`; each `Some`'s value is the item |
| `if`, `elif`, `else`, `while` (§4) | `branch` and `jump`; a branching expression writes a result register |
| Block expression (§4) | its statements, then `release` |
| Comprehension (§4) | the loop `for` runs, appending each kept value with `array`, the last array spread first |
| `match`, patterns, guards (§3.11, §4) | `switch` on the variant, then `field` and `move` for bindings, `equal` or `compare` for comparisons, `branch` for guards |
| `x is P` (§3.11) | the same tests, producing a boolean |
| `?.`, `??` (§4) | `switch` on `Optional` |
| `e?` on `Result` (§3.12) | `switch` on `Result`; the `Err` path returns a new `Err` of the function's own `Result` type, holding the same error |
| `panic(m)` (§3.12) | a call to prelude `panic` |
| Building an `Error` (§3.12) | `struct`, with `trace` from its default's entry, which calls a prelude extern that formats the frames' spans through the modules' line starts, leaving out the entry's own |
| Imports, type aliases (§3.13, §3.17) | nothing at runtime; `modules` lists module ids for spans |
| Lambdas, local `fn`, closures (§3.14) | `closure` with captures; a captured `let` is a cell, a `const` a copy |
| Named lambda calling itself (§3.14) | `currentClosure` |
| Calling a function value (§3.14) | `call` with a value callee |
| Annotations (§3.16) | `annotations` on functions and fields; `@Waypoint` becomes the `waypoint` of an `await` or `select` |
| `await` (§5) | `await`, which commits first |
| `runtime.commit()` (§3.8) | a call to an already-resolved future, then `await` |
| Slots and their operations (§6) | calls to prelude externs that return futures |
| Inbox, `futures`, `rpc`, `fanout` (§3.8, §6) | library code over slots: an `Inbox<T>` is a shared struct of one slot and a backlog, and `receive` is the slot's `take`; `futures.first` is the one extern, a `first` future |
| `defer f` (§7) | `defer`, into an unnamed register of the block |
| `WeakRef`, `deref()`, `disposed()` (§7) | calls to prelude externs |
| `worker.disposing()` (§7) | `currentCall` at the function's entry, into a hidden variable a nested function captures like any other, which the function's own name reads before a `.`; `disposing` is then an ordinary prelude method on that `_Call` handle |
| `sendRevertible`, `Revertible<T>` (§6) | library code: a `Revertible<T>` is a shared struct of its retraction, a `fn() -> unit`, which its declared `dispose` calls; an inbox retracts through a weak reference to itself, a host queue by disposing the host's revertible send it holds (`Revertible.holding`), which tells its host |
| `select`, `await select` (§8) | the case futures in source order, then `select`; per case: the future, the registers its expression created (`holds`), `bind` for `as`, and the target, where the case's `as` is a target its body declares; `otherwise` for the non-blocking form, which is `else`'s body. The `holds` are unnamed registers of the enclosing block, so the winner's last until it ends |
| Prelude and standard-library functions: `push`, `at`, `get`, `length`, … (§3.8) | calls to their entries; runtime-backed ones are externs |
| Versioning (§5) | an instance references its Definition's content hash for its whole life |
| Disposable cycles (§7) | nothing in the code; the release that leaves them held by nothing disposes them (Holders) |
| `main` (§9) | `Definition.main`, the default start: `main`'s entry in `starts` |
| Host starts an instance, operates a panicked one (§3.12, §9) | a start entry per startable function, listed in `starts` by key: the function's body with its arguments decoded from `Json` and every return encoded; the runtime's host API over Definitions and snapshots, the snapshot's `status` recording panics, outcomes and termination |
| `spawn f(args)` (§9) | `spawn` with the call's callee, a function or the value of a sendable function type, and its arguments, a method's receiver first, all by value |
| Values crossing the host boundary (§9), `json.encode`, `json.decode` | each type's codecs, `toJson` and `fromJson`: declared functions, or derived ones, the body of each `json._toJson<T>` and `json._fromJson<T>` instance, written from `T`'s derived form (docs/arch/boundary.md) |
| `@Suite`, `mock`, `testing.start`, `handle<T>()` (§10) | function annotations; a test Definition's `tests` table (every suite function with its title, and the testing module's `_list` and `_run`, which start each test's instance); natives over the testing capability, `mock` objects in the heap, `start` a spawn with its own option, watches as futures |
| `crashEveryAwait` (§10) | an option of each instance, kept in its snapshot: every segment runs twice before it commits |
