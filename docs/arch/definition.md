---
description: the Definition (compiled program, IR v4, persisted as avsc bytes v5) — tables, typed registers, the instruction families, lifetimes as instructions, starts, and how spec constructs lower; read before changing lowering, codegen, the verifier, or anything persisted
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-17
tags: [definition, ir, lowering, avro]
---

# Definition

A **Definition** is the whole compiled program and the contract between lowering and every backend
(ir-first design): flat tables of modules, types, functions and constants that refer to each other
by index, the starts a host may run, and what the program is for (`src/definition/`). Lowering makes
every decision; a backend (docs/arch/codegen.md) writes what each instruction says, and the run
(docs/arch/runtime.md) executes it. A committed instance's **snapshot** is the run's
(`src/runtime/snapshot/`, docs/arch/runtime.md).

A Definition is persisted for an instance's whole life as avsc bytes in a version envelope
(`formats/binary-format.ts`), keyed by their SHA-256. Its zod schema is the one description: the Avro
type is derived from it once (`formats/avro/`), and zod never runs on a Definition. A decoded
Definition is plain objects, an absent optional field absent, as lowering builds it. avsc is
imported through its types-only entry; a browser bundle shims the `buffer` and `util` it needs. Everything that
carries one carries an `EncodedDefinition` (value, bytes, hash) or the text a built module embeds
(hash and base64 bytes), both made and read by `definition.ts` alone, so a change of encoding stays
there. The toolchain's own output is trusted: encoded once, never read back or validated again.

## Decisions

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| How code is shaped | **Linear register code**: each function a list of instructions over numbered registers; a frame is `(function, pc, registers)`, the snapshot's own shape. | A tree with an explicit continuation stack, whose shape would have to be persisted. |
| Types in the code | **Typed registers** (IR v4): every register has a `TypeReference`; every type entry states `disposable` (it may reach a disposable) and `heap`; registers of a field loop's variable are one per pass's type. A backend reads lifetimes off types (`lifetimeOf`: counted, heap or plain). | Untyped instructions with a second runtime type system: a backend couldn't tell what to count. |
| Lifetimes | **Instructions**: parameters are borrowed and a last use is a move, so most holds never appear; `copy` holds, `letGo` lets go, places write in place where unique. The verifier fails a dropped or doubled hold. | A runtime that discovers holders by walking: it costs as much as the heap is large. |
| Generics | **Compiled per instantiation** (spec §3.5): every call has one target, every type entry is concrete. | Runtime type descriptors and dispatch. |
| Trait objects | **An enum per `any` type**, one variant per type converted into it; a call through a trait switches to that type's function, on the value a `&` receiver refers to. | A vtable carried with each value. |
| Calls | **One function table**; an extern is an entry naming its native by key and its signature. Natives speak primitives, get every capability the run has (typed by those they use) and hold what they keep themselves: optionals, `Result`s and enums are built by Istalang wrappers. | Separate extern tables and natives knowing program layouts; capabilities and keeps per extern, which no binding read: a native is written per backend, so its holds and needs are its own. |
| Defaults | **Computed by the callee's prologue**: a parameter left out arrives absent (`given`). | Caller-computed defaults or a sentinel value. |
| Starts | **`starts[{key, function, encode}]`**: `function` decodes the arguments from `Json` and calls the root, giving an async one's future unawaited; `encode` writes the outcome as `Json`, called the moment it settles, so a run ends when its root returns (spec §10). | A start awaiting the root then encoding: readied work would run between. |
| Encoding | **avsc binary, its type derived from the zod schema's in-memory side**: records in shape order, literals in no bytes, unions by JS type then literal tag, an `Int` its two's complement as bytes (any size), a float a double, an extern payload its canonical JSON. One Definition gives one byte string. | Canonical JSON (lossless-json): larger, and reading it ran zod and a parser over every value; a hand-written Avro schema beside the zod one. |

## Validation

Validation (`src/definition/validation/`) runs where bytes come from outside the toolchain, a store
or a file (`readDefinition`), and as an assertion in the compile test kit, so a bad Definition is
refused at load, never midway through an instance. It refuses:

- an index outside its table, in code and in the tables alike (`references.ts`);
- a part code steps into that its type lacks: a field, a variant, a tuple's element, a `struct` or
  `variant` built of the wrong number of fields, a `switch` whose targets miss a variant with no
  `otherwise` or pass the last (`parts.ts`);
- two starts of one key, or a `main` naming no start;
- a handle in a constant or an annotation, which only a running instance holds;
- an entry a purpose names that its caller may not call (a test's runner and suites ista code
  calls, the job server live code calls). A function type carries no mark, so the run holds every
  async call it starts to the rule: an instance starts code of its own kind alone;
- code the ownership verifier fails (`ownership.ts`), which judges each instruction on its last
  visit of a dataflow fixpoint.

## Frames

- An entry is `simple` (a plain call), `live` or `ista` (async, resumable on a frame record). Its
  registers list each register's type and whether it is borrowed; its parameters say which may be
  left out.
- `park {dst, stop, waypoint}` is the one suspension: the position its wait was decided for lands in
  `dst`; a call stopping as it is disposed goes to `stop`, its stop landing, which lets go of what
  the frame holds and ends with `stopped`. Lowering emits `_parking(wait)` before it and the cases'
  landings after it (docs/arch/runtime.md, waits).
- `currentCall`, `given`, `transient`, `contextConstant`/`makeContextConstant` and, in test builds,
  `mocked` are the other control instructions a frame needs. `mocked {dst, arguments, landing}`
  stands past the prologue: where a mock answers the call with `arguments`, every parameter's value,
  its answer lands in `dst` and the entry returns it from `landing` (docs/arch/runtime.md, mocks).

## Holders

Lowering places every hold and let-go (`functions/code-writer.ts`: `take` moves a single-use
register and copies a pinned or borrowed one; a temporary several paths give gets one owned
register; a back edge lets go of the loop's temporaries; a hold list is made anew per scope run).
A `return` states what it lets go of (`releasing`), its exit's let-gos one batch, which a call
stopping as it is disposed lets go of its value with. A backend only acts on them, by lifetime class (docs/arch/codegen.md); the run counts counted
values and disposes what loses its last holder in rounds, newest first (docs/arch/runtime.md).

## Places

A place is a root, a register, a cell (a variable a closure captures or a `&` passes, a shared struct's state) or a reference a `&` parameter holds, and a path of tuple, field and variant steps. `load` reads a place (into a borrowed register, a borrow, or into an owned one, another holder), `store` writes one, changing in place where the value is unique, and `reference` makes the `&` argument a call passes; following a path never runs code.

A borrow, of a register's value or of a part of it (`tupleItem`, `structField`, `variantField`, a borrowing `load`), holds nothing: it reads what it was read from only while that stays as it was. Lowering decides, per flow, which reads something may change before their last use (a write of their variable or of a part of it, a `&` argument, a release; where other code reaches it, a cell a closure shares, a `&` parameter's place, a handle's state, anything running code but a native given values alone), and makes those hold their value instead (`flow/held-reads.ts`), so a value read never changes and outlives its replacement.

An indexed element is no step of a place, so every element read and write is a call: `index` and `setIndex(&container, key, value)`, as the checker resolved them for its container.

## Values

| In memory | On disk |
| --- | --- |
| `null` (unit), boolean, string | the same |
| `bigint` (`Int`) | two's-complement bytes; a snapshot: a JSON integer |
| `number` (`Float`) | a double; a snapshot: `{kind: 'float', value}`, NaN, ±Infinity and -0 as strings |
| tuple, struct, variant, array, map, closure | `{kind, …}` with child values; structs and variants by type index, a struct's fields in name order (§3.1 "Field order"), a variant's in declaration order |
| extern value | `{kind: 'extern', type, payload}`; the payload is plain JSON, persisted and compared by `==` and map keys as its canonical text (codec.ts) |
| handle | `{kind: 'handle', object}`; never in a constant |

Map entries keep the runtime's order, so a restore iterates the same way.

A persisted value nests at most `maximumDepth` (256) levels (spec §5), since the codecs recurse on the host's stack; the snapshot format refuses a body deeper than any valid one before either codec runs, and a Definition's bytes too deep for avsc to walk are refused as a FormatError. Walks over values in memory (`==`, map keys, handles, depth) keep stacks of their own, so a deeper value lives within a segment, and the runtime panics a segment that would commit one.

The built-in `==` and map keys are `foundation/language/values.ts`'s rules, shown the runtime's values by `definition/values/equality.ts` and compile time's constant forms by the checker, so the two can't disagree. Neither compares a value's instantiated type: two values compared are of one static type, and a value converted part by part keeps its own type id where its layout stays (spec §3.5), so a `Box<"s">` taken as a `Box<String>` equals one built as a `Box<String>`.

Values are immutable to a program. A `constant` instruction hands its register the pool's own value, and a bound program, its pool included, is shared by every instance a runtime runs, so a write through a place (`store`, `setIndex`) builds the new value along its path, as value semantics (spec §3.1) has it, except where no one else could see the old one: a node the instance made and holds once, which it changes in place (`runtime/run/lifetimes.ts` `owned`). A host never sees one change: what it got is a frozen copy, and the JSON kept for it is forgotten as the node changes (docs/arch/boundary.md, "Identity at the boundary").

## Externs

An extern entry has its own shape: no frame, no captures and no mode (it returns a future instead), and parameters with their types, by value or by `&` as declared: the prelude's `push`, `pop`, `delete` and `setIndex` take their container by `&`. A native receives such an argument's value, and writes the changed value back through its context, which writes it to the place the `&` names. Its `key` binds it to a native: the declaring module's canonical name, the declared name, and the declared parameter types, `time.at(time.Time)` or `prelude.push(&prelude.Array<T>, T)`. Every named type in a key is module-qualified and written without sugar (`prelude.Optional<Int>`, never `Int?`), so two modules' types never share a key. An anonymous struct in a key is spelled by its fields, `struct { a: Int; b: String }`, since it has nothing else. A function type in a key is spelled by its kind, what it takes and what its call gives, `ista fn() -> prelude.Future<R, "ista">` for an `ista async fn() -> R`, which is that type (spec §3.14); an unmarked one writes no kind, and a key doesn't tell `sendable` apart. `externKey` (`definition/extern-key.ts`) is the only place a key is spelled: lowering and every natives table build keys through it. Overloads therefore get distinct keys, and every instantiation of a generic extern shares one native. The entry also carries the instantiation's parameter and result types (`parameters`, `result`), which natives build their results by. An extern constant is an entry with `constant` set: its read is an accessor entry, as an `ista const`'s, so it is read once per instance and then kept for the instance's life (spec §3.6), in the snapshot's `contextConstants`.

An extern a host implements is called through a code entry, its wrapper, which encodes each argument as `Json`, calls the extern entry, and decodes what comes back; the extern entry's parameters and result are all `json.Json` (a `Future<json.Json, "live">` for one returning a future, a `live async` extern), and it carries its `declaredType` (a function's result, a constant's type), which the runtime holds the host to across deploys. Reading a host's extern constant is a call to an entry that decodes its value the same way (docs/arch/boundary.md).

## Names

A function entry's `name` is for traces to read; entries are identified by index, and names may repeat. It is the declaration's name qualified by its module's canonical name (`time.delay`, `prelude.Slot.create`). An instance of a generic function spells its type arguments by their table keys (Types and locations): `main.show<#main.Money<>>`, `main.first<|<Int,None>>`. A mark parameter is a written type argument, so each mark's instance has a name of its own (`main.retry<="live", Int>`). A function's defaults are computed in its own entry's prologue, so no entry of its own names them. A struct's or variant's fields are the parameters of a function of their own, whose entry, computing the defaults a literal or call leaves out and building the value, is named after the struct, or the variant with its enum (`main.Retry`, `main.Shape.Circle`); an extern's entry computing its defaults is named as the extern. A lambda or local function (spec §3.14) is an entry per instance of the top-level function holding it, named after that instance and its own name, or where a lambda stands: `main.makeCounter.next`, `main.run.lambda@12:9`; one in a default is named after the function the default is of.

## Types and locations

A type entry is identified by its index; its `name` is a label for traces. A declared type's entry is named by its module-qualified declaration, with its `arguments` (`time.Time`, `prelude.Array` with `[Int]`), which don't identify it either: a `TypeReference` leaves out a function type's `&` parameters, sendability and kind, so `main.Box<fn(&Int) -> Int>` and `main.Box<fn(Int) -> Int>` are two entries of one name and arguments. Any other entry, a union's, an `any` type's or a recursive type's `alias`, is named by its type's table key, with no arguments. A type's table key is its checker key (`checker/types/identity/type-keys.ts`) with each identity spelled by its qualified name in place of a number, from the same structural walk: canonical, injective over types, and a function of the type alone, never of an alias it was written through or of what else the program declares (`#prelude.Array<Int>`, `|<Int,None>`, `fn<="simple",="plain">(&Int)->Int`, `any{main.Named<>}`). The runtime recognizes no type by its name, only by its `role` (below). An anonymous struct has no name. A structural function type is what it takes and what its call gives, an async one's result being the future its call gives (spec §3.14).

A recursive type (spec §3.17) is the entry of what it unfolds to, a union's enum, a shape's struct or a declared type's, whose layout refers back to it through the table. Entries are identified by the type's structure, as the checker keys it, so equal recursive types written through different aliases, or written out, share one entry, and adding or renaming an alias changes no entry's identity. Its table key is its minimized graph's, with `~i` where a node is reached again (`~[|<Int,~1>;#prelude.Array<~0>]` for `type Tree = Int | Array<Tree>`, however written and whichever aliases the program declares), so no alias names an entry and a program's Definition is the same whatever modules beside it declare. Every type is spelled from its structure alone, never from the alias, associated type or representation it was reached through, so every spelling of a member orders a union's variants alike. One unfolding to a tuple or a function type, which have no entry of their own, has an `alias` entry, its `type` that structural type, so a reference holding it ends: `type Machine = fn(Int) -> Machine`; the same tuple or function type written out refers to that entry too. One unfolding to a declared type is that type's entry, one per instantiation whether reached through the alias or written out. The `json` role belongs to the enum of the type `json.Json` is, by structure. Extern keys spell a recursive type by the alias the extern's signature writes, else the alias its graph is labelled with, else its table key (`lowering/tables/extern-keys.ts`). No value has an alias entry as its type.

Every type entry states `disposable`, whether a value of it may reach a disposable (the checker's `reachesDisposable`), and `heap`, whether it is an allocation a backend shares; a backend reads its lifetime class off them (`lifetimeOf`). Its kinds are `struct`, `enum` (`role: json` for the json module's `Json`), `shared` (a shared struct's handle: a cell holding the struct entry `value`), `extern` and `alias` (a recursive alias's tuple or function type). A shared or extern entry's `dispose` is the declared `dispose`'s instance, run as a value loses its last holder.

An extern entry's `role` says what the run makes of its values: `array` and `map`, which natives and JSON read and write as their own; `cell`, a variable's cell; `weakRef`; `instance`, a spawned instance's handle; and `call`, an async call's handle, its execution. An extern entry with no role is a host's type: its values are its host's JSON, or resource objects when it declares a `dispose`.

Each module carries its line starts. The runtime has neither source text nor the compiler, yet it turns spans into locations for `Error.trace`, a panic's trace, `waitingAt()` and the operator's view.

## Time

`now()` returns the time its segment started (spec §5). A panicked instance's snapshot records when the failed segment started, so an operator's retry sees the same time.

## Snapshot

The snapshot is the run's format, not the Definition's: see docs/arch/runtime.md (snapshots). It
names its Definition by hash; frames hold function indexes and pcs into it.

## How each construct lowers

Instruction names are in `code`. A call is always to a function-table entry; for primitives that entry is a prelude extern.

| Construct (spec) | Lowered to |
| --- | --- |
| `struct` declaration, indented or one-line (§3.1) | a `struct` type entry per instantiation, its fields in name order, as a shape's |
| Anonymous struct type, a shape: `struct { … }`, an indented field block (§3.1) | a nameless `struct` type entry, one per shape: every place writing equal fields shares it, its fields in name order |
| Recursive types (§3.1) | type references by index, so a type can name itself through the table |
| `enum` declaration, `Result`, `Error` (§3.11, §3.12) | an `enum` type entry per instantiation, with, for `json.Json`, its `role`; `Error` is a `struct` entry |
| Union `A \| B`, `T?`, literal types (§2) | an `enum` type entry per union, named by its table key, one variant per member, ordered and named by the member's table key, so no two variants share a name and the runtime finds a member's variant by it: a member with values holds the field `value`, a literal or `None` member nothing (lowering/values/unions.ts); a lone literal type is its base's value |
| `extern struct`, `extern shared/sendable/live struct` (§3.6, §3.8) | an `extern` type entry per instantiation, with its declared `dispose` entry (§7) and, for `Array`, `Map`, `_Cell`, `WeakRef`, `Instance` and `_Call`, its `role`; which handle it is stays the checker's, since the runtime reads only its `dispose` and role |
| `shared struct X` (§3.18) | a `shared` type entry per instantiation: `value`, the anonymous struct entry of its fields behind the handle, and its declared `dispose` entry |
| Traits, `T is A & B`, `Sendable`, `Disposable` as constraints (§3.5, §3.10) | nothing at runtime: the checker resolves every constrained call per instantiation |
| `any A & B` (§3.10) | an `enum` entry named after the type, one variant per type converted into it, each with the one field `value`; a conversion is `variant`, or, from another `any` type, a call to an entry converting variant by variant; a call through a trait, or a required field's read, is a call to an entry that `switch`es over every variant and calls that type's function or reads its field, passing a `&self` receiver on by `&` into the variant; a downcast pattern is a `switch` on the type's variant, with `otherwise` for the rest |
| Value semantics and handle identity (§3.1) | `move` hands a value on and `copy` makes another holder of it; a write changes a value in place only where nothing else holds it, and copies it from there down where something does (Places); handles compare by object id in `equal` |
| `@JsonName`, `@JsonSkip`, `@JsonBigInt` (§3.16, §9) | `annotations` on the field's type entry, for tools; derived codecs are compiled from the checker's derived forms, which read them |
| Literals: int, float, string, bool, `none`, durations (§2) | `constant`; a duration is a `time.Duration` struct constant, `none` the `None` variant of the optional expected, or `null` where `None` itself is |
| Template (§2) | without values, its text's `constant`; otherwise each value's `toString` call, in order, an `array` of the non-empty texts and those, and a call to the prelude's `join` with `""`; a tagged template is the call it stands for, its texts an `array` of constants |
| Docstring (§2) | nothing: tools read it from the tree |
| Array literal and spread (§2) | `array` with item and spread elements; a spread of an array is a spread element, which copies it, and any other spread the loop `for` runs over its operand, each item appended with `array` to what the elements before it built |
| Map literal (§2) | `map` for a `Map`: a spread of a map is a spread entry, which copies its entries, and any other spread the loop `for` runs, each `(key, value)` item an entry added with `map` to what the entries before it built; for another `IndexAssignable`+`Default` type, a call to `default`, then a `setIndex` call per entry, and for a spread the loop `for` runs, with a `setIndex` call per item |
| Tuple, `()` (§3.15) | `tuple`; `()` is the unit constant |
| Range `a..b`, `a..=b`, open ends, `by` a step (§2, §3.8) | what its core is (checker/desugaring/ranges.ts): a literal of prelude `Range`, an open end `none` and its `step` 1 unless `by` gives one; `..=` a call of the prelude's `_inclusiveRange(start, end, step)`, which stores the end one past the written one in the step's direction |
| Struct literal: named, shorthand, positional, `struct{…}` (§3.1) | the fields evaluated as written; `struct` takes them by name into its type's layout. A literal leaving fields out instead `call`s its struct's entry with every field in declaration order, each left out `omitted`, which computes them in its prologue, each seeing the fields before it, then builds the struct, a shared struct's in a new cell |
| Updated copy `T{...r, f: v}` (§3.1) | the spread value once, `structField` for each field not given, then `struct` |
| Struct without fields, written bare (§3.1) | `struct` with no fields; a constant when it is one |
| Enum variant (§3.11) | `variant`; a variant without fields may be a constant, and `Expired()` is its value; a call of a variant's constructor binds its arguments as any call does, defaults and a rest included, then builds `variant` of the parameters in place, with no `call`; one leaving fields out calls the constructor's own entry instead, which computes them in its prologue and builds the same, as it does for what is handed an entry to call later |
| A value put into a union, `T` into `T?` among them (§2) | `variant` of the member it goes into; a union put into a wider one, a `switch` building the wider one's variant per member |
| A one-element tuple and its element converted into each other (§3.15) | `tuple` of the one value; a `tupleItem` read of element 0 |
| `fn`, `async fn`, methods, static functions (§3.3, §3.7) | function-table entries; a method's `self` is its first parameter |
| Overloads (§3.7) | distinct entries; calls name one |
| Default parameters (§3.3) | a call passes each parameter it leaves out `omitted`, and the function's entry computes it in its prologue (Frames); a function named as a value of a shorter type is the function's own entry, called with fewer arguments, so a deferred call's and a spawned one's defaults are computed when the call runs; a call leaving a native extern's defaults out calls the extern's entry computing them, and a host extern's wrapper computes its own |
| Field defaults (§3.1) | computed in the prologue of the entry of the function the fields read as (one per instantiation), as a parameter's default is |
| Rest parameter, spread argument (§3.3) | the caller builds the rest parameter's `array` from the arguments it collects, as an array literal of them, spreads included, where the first of them stands; an extern's native takes that array |
| Pack (§3.5) | nothing of its own: each instantiation is a concrete tuple, so a pack's rest parameter is one parameter per element, of which the entry builds the parameter's `tuple`; a caller passes a pack's arguments as they stand, and a spread of a pack's value as a `tupleItem` read of each element |
| Named arguments (§3.3) | the arguments are evaluated in the order written, then each call takes its parameters in their order; names don't reach the Definition |
| `return`, last expression (§3.3) | `return` |
| `extern fn`, extern constant (§3.6) | `extern` function entries; reading a constant is a `call`; a host's is called through its wrapper, which converts to and from `Json` (Externs) |
| `let`, `const`, assignment (§3.4) | registers; `move` or a write through a cell |
| Top-level `const` (§3) | computed while compiling into a constant; reading one is a `constant` instruction, like a literal; a lambda in one is a closure constant of no captures, its function an entry of its own |
| `ista const` (§3.4) | an accessor entry of its own, called by every read: `contextConstant` gives the instance's value, keyed by the constant's qualified name, and jumps past the initializer once it was made; else the initializer's value, made the instance's with `makeContextConstant` |
| `transient let` (§3.4) | its cell register, filled by `transient`, which shares a nested-in call's cell and jumps past the initializer; else the initializer, whose write makes the cell (Frames) |
| Block end, `break`, `continue` (§3.4, §4) | `letGo` of the block's registers, then `jump` where needed; a labelled `break` or `continue` ends every block up to the loop it names |
| Labelled loop or block (§3.4, §4) | the loop or block, inside a block holding its list when some `hold(name)` names it |
| Statement end, a header's end (§7) | `letGo` of the temporaries it left; a header's on every path out of it, before the body |
| `hold let`, `hold const`, `hold _`, `hold(name) …` (§3.4) | `append` into the hold scope's array, let go of at the scope's end (the function's, at its return) |
| `_ = e` (§7) | an unnamed register, released at the block's end |
| `drop x`, `drop e` (§7) | `letGo` of `x`; for an expression, its temporaries at the statement's end |
| Destructuring `a, b = t`, `const Pair{first} = p`, at any depth (§3.15) | the value once, then `tupleItem`, `structField` or `variantField` reads along each target's path, and a `move` or `store` per target |
| Tuple element `t.0`, `t.0 = v` (§3.15) | `tupleItem` by position; `store` with a `tuple` step |
| Generic functions and types (§3.5) | one entry or type per instantiation |
| `&x` argument, reference parameter (§3.7) | `reference` to the place, passed as the argument; the parameter's register is of a `reference` type; `x` lives in a cell; `&m[k]` copies the element into a cell around the call (Places) |
| `new X{…}` (§3.18) | the fields' `struct`, then `newCell` with the shared struct's entry |
| `*x`, `*x = v`, `x->f = v`, `&x->f` (§3.7, §3.9) | `load` of the cell place reads it; a write is a `store` to it; a `&` passes a `reference` to the place to a native, and copies the part into a cell around a call of code (Places) |
| Operators (§3.9) | a `call` to the resolved function; `x in c` calls `includes(c, x)`, and `not in` adds `not` |
| A chain `a < b == c` (§3.9) | each operand evaluated once, in order; per link, `equal` (and `not` for `!=`) or a `call` to the `compare` made at its right operand and `order`, then a `branch` to the chain's end when it fails |
| `<`, `<=`, `>`, `>=` (§3.9) | a `compare` call, then `order` |
| `==`, `!=` (§3.9) | `equal`, plus `not` for `!=` |
| `not`, `and`, `or` (§3.9) | `not`; `branch` (short-circuit) |
| `x[k]`, slicing (§3.9) | a call to the resolved `index` |
| `x[k] = v`, `a[k].b = v`, `x[k] += 1` (§3.9) | a `setIndex` call taking the container by `&`; a deeper write reads each element with `index` when it writes and writes it back with `setIndex` (Places); compound forms call `index` and the operator first |
| `T(x)` (§3.10) | a call to `T.from` |
| Trait-constrained calls, `T.zero()` (§3.10) | resolved per instantiation; plain calls |
| `for x in c` (§3.10, §4) | a call to `iterate`, then a loop calling the cursor it gives, a function value, until a `switch` on the `Step` it gives finds `Done`; each `Next`'s value is the item |
| `if`, `elif`, `else`, `while` (§4) | `branch` and `jump`; a branching expression writes a result register |
| Block expression (§4) | its statements, then `letGo` |
| Comprehension (§4) | the loop `for` runs, appending each kept value with `array`, the last array spread first |
| `match`, patterns, guards (§3.11, §4) | `switch` on the variant, then `variantField` and `move` for bindings, `equal` or `compare` for comparisons, `branch` for guards; an array pattern `call`s the prelude's `length` (and `compare` against its fixed count, with a rest), then `_patternItem` and `_patternRest` for its items; a range pattern `call`s `compare` at each bound; an or-pattern tries each alternative's tests in turn, `move`s which one matched into a register, and once every test passed binds from that alternative after `equal` and `branch` on it |
| `x is P` (§3.11) | the same tests, producing a boolean |
| `?.`, `??` (§4) | `switch` on the optional's variants (lowering/values/optionals.ts) |
| `x!` (§4) | `switch` on the optional's variants: a member's gives its value, `None`'s calls the prelude's `panic`, which never returns |
| `e?` on `Result` (§3.12) | `switch` on `Result`; the `Err` path returns a new `Err` of the function's own `Result` type, holding the same error |
| `panic(m)` (§3.12) | a call to prelude `panic` |
| Building an `Error` (§3.12) | a `call` to its struct's entry, which computes `trace` in its prologue by a prelude extern that formats the frames' spans through the modules' line starts, leaving out the entry's own frame, still in its prologue |
| Imports, type aliases (§3.13, §3.17) | nothing at runtime; `modules` lists module ids for spans |
| Lambdas, local `fn`, closures (§3.14) | `closure` with captures; a captured `let` is a cell, a `const` a copy |
| Named lambda calling itself (§3.14) | `currentClosure` |
| Calling a function value (§3.14) | `call` with a value callee |
| A function value widened (§3.5, §3.14) | a `closure` of its pair's `wrapping` entry, capturing the value: it converts the arguments, calls the value and converts what it gives; a future it gives is converted as it is (prelude `_converted`), so the entry is simple and the call stays the function's own; a start of it starts the function it wraps |
| A plain function made async (§3.14) | a function value widened (above): a `closure` of the pair's `wrapping` entry, capturing the plain value |
| Annotations (§3.16) | `annotations` on functions and fields; `@Waypoint` becomes the `waypoint` of the `park` an `await` or `select` stops at |
| `await` (§5) | a call of the prelude's `_wait` on the running call, then `_caseResolver` for case 0, handed to the operand's `onAwait` (the implicit call the checker recorded) and let go of, then `_parking(wait)` and `park`, which commits first (`lowering/calls/waits.ts`); synthesized code awaiting a future calls the prelude's `onAwait` alike |
| `runtime.commit()` (§3.8) | an already-resolved future, awaited |
| Slots and their operations (§6) | library code: `Slot<T>` is the prelude's Istalang, over futures and resolvers |
| Inbox, `futures`, `rpc`, `fanout` (§3.8, §6) | library code over slots and resolvers: an `Inbox<T>` is a shared struct of one slot, each message a `put` queued on it, and `receive` is the slot's `take`; `futures.first` is a struct whose `onAwait` registers a `Resolver.at` of its resolver on each future, and has no extern |
| Deferred call `g f(args)` (§3.14) | what the checker checked it as (checker/desugaring/deferred-calls.ts): a call of the taker `g`, given, where the checker's binding numbers it, a closure built in a block of constants holding what the call computes now, in order (the callee's value or receiver, then the arguments, a nested deferred call's parts among them); the closure is a lambda's, making the call from those constants, so a default it leaves out is computed when it runs |
| `_ = defer f(x)` (§7) | a deferred call (§3.14) of the prelude's `defer`, giving a `Deferred<M>`, a shared struct of the function, of its mark `M`, whose declared `dispose` calls it; `_` keeps it in an unnamed register of the block |
| `WeakRef`, `deref()`, `disposed()` (§7) | calls to prelude externs (`stdlib/prelude/weak-natives.ts`) |
| `worker.disposing()` (§7) | `currentCall` at the function's entry, into a hidden variable a nested function captures like any other, which the function's own name reads before a `.`; `disposing` is then an ordinary prelude method on that `_Call` handle |
| `sendRevertible`, `Revertible<T>` (§6) | library code: a `Revertible<T>` is a shared struct of its retraction, an `ista fn() -> Unit`, which its declared `dispose` calls; an inbox retracts through a weak reference to itself, a host queue by disposing the host's revertible send it holds (`Revertible.holding`), which tells its host |
| `select`, `await select` (§8) | the case awaitables in source order, then a wait on them opened as an `await`'s is, a `_caseResolver` per case, then `_parking(wait)` and `park`, its landing a `switch` on the position decided; per case: the registers its expression created (`holds`), `bind` for `as`, and the target, where the case's `as` is a target its body declares; `otherwise` for the non-blocking form, which is `else`'s body. The `holds` are unnamed registers of the enclosing block, so the winner's last until it ends |
| Prelude and standard-library functions: `push`, `at`, `get`, `length`, … (§3.8) | calls to their entries; runtime-backed ones are externs |
| Versioning (§5) | an instance references its Definition's content hash for its whole life |
| Disposable cycles (§7) | a compile error; a cycle reaching no disposable is left out of the next commit (Holders) |
| `main` (§9) | `Definition.main`, the default start: `main`'s entry in `starts` |
| Host starts a live run, operates a panicked instance (§3.12, §9) | a start entry per startable function, live or simple code, listed in `starts` by key with its outcome's encoder, the codec writing its type: a call of the function with its arguments decoded from `Json`; the runtime's host API over Definitions and snapshots, the snapshot's `status` recording panics, outcomes and termination |
| `spawn f(args)` (§9) | a deferred call (§3.14) of the prelude's `spawn` extern, whose native spawns the closure it is given as the new instance's call and gives the `Instance<T>`, a value of the `instance` type entry it names, holding the new instance's name; that entry's `encoder` encodes its outcome. The closure is the instance's root call, code or an extern (`spawn(runtime.commit)`), whose answer is the outcome: an async entry's execution's return value, or what a simple entry returns or an extern answers, a future awaited through an `outcome` object (Snapshot) |
| `runtime.delegate(job)` (§5), the runtime's jobs | library code over a context constant (`runtime._jobs`): an inbox the job is sent to, and a slot per job its result is put in, as JSON; the job's future, released, withdraws it, which cancels it through the inbox if it runs. The live loop serving them, `runtime._serve`, is lowered only with a program reaching `delegate`, as `Definition.jobServer`, which `Runtime.open` starts; it serves each instance through calls into it, its natives the names of the instances it serves and its own calls, which leave an instance's panic for the host to hear (docs/arch/boundary.md) |
| `inst.result()`, `runtime.isolate(f)` (§9) | a native making a watch future on the instance; `isolate` a native spawn of `f` with `terminatesOnPanic`, then `result()`, its outcome encoded as `spawn`'s is |
| Values crossing the host boundary (§9), `json.encode`, `json.decode` | each type's codecs, `toJson` and `fromJson`: declared functions, or derived ones, the body of each `json._toJson<T>` and `json._fromJson<T>` instance, written from `T`'s derived form (docs/arch/boundary.md) |
| `@Suite`, `mock`, `testing.spawnCrashingEveryAwait`, `handle<T>()` (§10) | function annotations; a test Definition's `tests` table (every suite function with its title, and the testing module's `_list` and `_run`, which start each test's instance); natives over the testing capability, `mock` objects in the heap, `spawnCrashingEveryAwait` a native spawn with its own option, watches as futures |
| `crashEveryAwait` (§10) | an option of each instance, kept in its snapshot: every segment runs twice before it commits |
