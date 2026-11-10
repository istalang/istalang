---
description: proposal 12 of docs/proposals, for variadic type parameters as tuples — a tuple as a product keyed by position on top of proposal 4's struct machinery (`keyof`, `T[I]`, mapped types, field loops, comprehensions, type `match`), a pack as a type parameter constrained to tuples, struct rests taking named arguments with the struct's defaults, several tuple rests when their keys are equal, a `where` clause for relations between type parameters, `enter` for brackets, and as a second stage refinement by patterns with spreads inside tuples typed by segments; supersedes the `<...A>` spelling and tracker F26's `each`, implements F3; read before designing or changing packs, rest parameters, tuples' keys, `where` or what patterns teach about types
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-10
tags: [proposal, language, types, generics, tuples, packs, rests, f3, f26]
---

# Proposal: variadic tuples

A function or type can take any number of type arguments, each its own type, and map, constrain
and iterate them, with no mechanism of its own: a tuple is a product keyed by position, as a struct
is keyed by name, so proposal 4's computed types serve both.

## Example

```python
# Mixed-type futures: Future<(Int, String)> from a Future<Int> and a Future<String>
async fn all<A is tuple>(...fs: ( [I in keyof A]: Future<A[I]> )) -> A:
    (for _, f in ...fs: await f)

# zip of any number of arrays, each with its own type
fn zip<A is tuple>(...cols: ( [I in keyof A]: Array<A[I]> )) -> Array<A>:
    let n: Int? = none
    for _, c in ...cols: n = math.min(n ?? c.length(), c.length())
    [for r in 0..(n ?? 0): (for _, c in ...cols: c[r])]

# One requirement on every element
fn line<A is tuple { [_] is Stringable }>(...parts: A) -> String:
    [for _, p in ...parts: p.toString()].join(" ")

# A pack used twice, both times as a rest: the arguments split in half
fn run<A is tuple>(...fs: ( [I in keyof A]: fn(A[I]) -> Unit ), ...args: A):
    for i, f in ...fs: f(args[i])
run(printInt, printStr, 1, "a")

# Two packs with equal keys, paired element by element
fn pairs<A is tuple, B is tuple>(...a: A, ...b: B) -> ( [I in keyof A]: (A[I], B[I]) )
    where keyof A == keyof B:
    (for i, x in ...a: (x, b[i]))
pairs(1, "x", true, 2.0)                    # ((1, true), ("x", 2.0))

# Named arguments into a struct, with its defaults
struct RequestOptions { timeout: Duration = 30s, retries: Int = 0 }
fn get(url: String, ...opts: RequestOptions) -> Future<Response>: request("GET", url, ...opts)
get(url, retries: 3)                        # opts is RequestOptions{retries: 3}

# A variadic type
shared struct Signal<A is tuple> { listeners: Array<fn(...A) -> Unit> }
fn emit<A is tuple>(self: Signal<A>, ...args: A): for l in self->listeners: l(...args)
```

## Rules

### 1. Tuples are products keyed by position

- **Keys.** A tuple's keys are its positions as `Int` literal types, in order:
  - `keyof (Int, String)` is `0 | 1`, and `keyof ()` is `Never`;
  - `T[I]` is the element's type, and `t[i]` the element, a place, as a struct's `s[k]` is;
  - `t.0` is `t[0]`, so it reads a constrained or mapped tuple's known positions too.
- **Every key-reading construct of proposal 4 takes a tuple,** visiting keys in position order
  where a struct's go in name order:
  - **field loops,** `for i, v in ...t:`, checked once per known position and once for the
    positions not known yet;
  - **array comprehensions,** `[for i, v in ...t: e]`;
  - **mapped tuple types,** `( [I in keyof A]: G<A[I]> )`: a tuple, one element per key.
    - The parentheses mark the product, as braces mark a mapped struct type.
    - Parentheses take a tuple's keys, which are contiguous `Int`s from `0`; braces take a
      struct's `String` keys. Anything else is an error.
  - **tuple comprehensions,** `(for i, v in ...t: e)`, building one element per pass, as a struct
    comprehension builds a field;
  - **member parameters,** `I in keyof A`;
  - **type `match`** (§3.17):
    - `case tuple:` and `case tuple { 0: infer H, [_] is C }:` beside `case struct …:`;
    - `case fn(...infer A) -> infer R:` binds a function's parameters as one tuple.
- **A comprehension over keys not all known** is the mapping of its subject's keys to its
  expression's type when nothing is expected of it. This holds for structs and tuples alike, so
  `(for _, s in ...each: await enter(s))` is `( [I in keyof A]: Entered<A[I]> )`. Today a struct
  comprehension there reports 5167.
- **A one-element tuple still converts** (§3.15), so a pack of one reads as its value.

### 2. A pack is a type parameter constrained to tuples

- **`A is tuple`,** beside `S is struct`. It takes a tuple constraint's entries, as a struct
  constraint takes fields:
  - `A is tuple { [_] is Stringable }` constrains every element;
  - `A is tuple { 0: Int, [_] is C }` also requires a first element, so a length of at least 1.
  - An entry's key is a non-negative `Int`. Naming a position requires every position before
    it, each taking the `[_]` rule, if any.
- **No separate kind of parameter.** `<...A>` is respelled `<A is tuple>`. The restrictions that
  existed only for packs go:
  - a pack may take constraints and a default (`A is tuple = ()`);
  - any declaration may have one (`struct Zip<A is tuple>`);
  - with a variance, written or derived (§5).
- **Opaque in a generic body,** as a constrained struct's other fields are. Its elements meet
  their constraint's entries; a field loop gives them one pass.
- **A product meets a trait derived from its parts,** such as `Sendable`, exactly when every
  part does. For structs and tuples alike:
  - `A is tuple & Sendable` gives each `A[I]` `Sendable`;
  - `A is tuple { [_] is Sendable }` makes `A` itself `Sendable`.
  
  Today a struct constraint gets only one direction of each.
- **`tuple` and `where` are contextual words** (§2), not reserved.

### 3. Rests

A call fills parameters as a struct literal fills fields (§3.3). Rests take what's left of the
call, in the product their type names:

| Rest | Takes | Builds |
|---|---|---|
| `...xs: Array<T>` | the positional arguments left | an array (today) |
| `...args: A`, `A` a tuple type or `A is tuple` | the positional arguments left | a tuple |
| `...opts: S`, `S` a struct type or `S is struct` | the named arguments naming no parameter of the function | `S`, as its literal would, its defaults included |

- **Order.** Rests come after the parameters with defaults. A function has at most one named
  rest. Its positional rests are one array rest, or any number of tuple rests.
- **Several tuple rests** must have equal keys: they use the same pack, are mapped over the same
  keys, or a `where` says so (§4).
  - A spread of a known tuple first becomes its elements.
  - Each rest then takes single values or one spread of a tuple whose elements aren't known, as
    one rest does today. Single values and such a spread in one rest make its tuple `(X, ...A)`,
    which spreads inside tuple types give (§7).
  - The rests' equal keys then decide the split:
    - with single values only, k rests split m values m / k each, in order, and a count k
      doesn't divide doesn't fit, as a wrong count doesn't today;
    - otherwise each rest takes one spread, and those spreads' keys must be tied.
  - Nothing else needs a rule. m single values have keys `0` to `m − 1`, which no tuple whose
    elements aren't known is proven to share, so equal keys already refuse a split that would
    give one rest single values and another a spread. A spread whose tuple is known has become
    single values.
  - So `run(printInt, printStr, 1, "a")` gives `fs` two and `args` two, and `pairs(...a, ...b)`
    gives each rest its spread.
- **A positional rest and a named rest** take different arguments, so they stand together.
  - A spread goes by its own type: a struct to the named rest, anything else to the positional.
  - A struct that is also `Iterable` is ambiguous there, an error asking for the rest's name.
- **A named rest** builds its struct with the literal's rules:
  - **Errors:** a required field left out, or a name the struct doesn't have.
  - **A spread** gives its fields, and later named arguments override them, as
    `Req{...req, value: "new"}` does. A spread still comes before named arguments (§3.3).
  - **Collisions:** the struct's known fields may not share a name with the function's other
    parameters or the rest itself. For an open `S is struct`, a named argument naming one of the
    function's parameters goes to that parameter.
  - **A generic `S is struct`** is the shape of the named arguments given.
  - **Choosing, clashes and fitting a function type** treat its fields as the function's named
    parameters, required or defaulted as the struct declares them (§3.3, §3.7, §3.14).
  - **Defaults run where parameters' defaults run,** in the callee's execution, even when the
    callee is spawned (§3.3, §9).
- **Every rest takes a whole value by its name,** as an array rest does today:
  `get(url, opts: o)`, `call(plus, args: (1, 2))`. Giving `opts: o` beside one of its fields is
  a field given twice.
- **Function types** have no names (§3.14):
  - a named rest is one positional parameter of its struct, `fn(String, RequestOptions)`;
  - tuple rests are spreads at the end of the parameters, `fn(Int, ...A, ...A)`, several only
    with equal keys. A spread before a parameter stays an error (5087).

### 4. `where`

- **A clause after a declaration's header** holds relations between type parameters, joined by
  `and`. It comes before the body's `:` or an alias's `=`, or ends a declaration that has
  neither, such as an extern function or a trait's requirement:

  ```python
  fn pairs<A is tuple, B is tuple>(...a: A, ...b: B) -> ( [I in keyof A]: (A[I], B[I]) )
      where keyof A == keyof B:
  struct Zip<A is tuple, B is tuple> where keyof A == keyof B:
  type Pairs<A is tuple, B is tuple> where keyof A == keyof B = ( [I in keyof A]: (A[I], B[I]) )
  ```

- **Its scope is the whole declaration:** parameters, result and body.
- **One home for each kind of requirement:**
  - what one parameter meets stays on the parameter (`A is tuple & Sendable`), `&` joining what
    it meets;
  - a relation between parameters goes in `where`, `and` joining relations.
- **The relation, for now: `keyof X == keyof Y`.**
  - `X` and `Y` must be the same kind of product: both tuples or both structs.
  - It is checked wherever the parameters get arguments, as a constraint is.
  - In the declaration it is a fact: `keyof X` and `keyof Y` are one type, so `Y[I]` is defined
    for `I in keyof X`. A field loop's key over an `X` value reads a `Y` value, and a
    comprehension over an `X` value builds a `Y`.
  - A position or field one side's constraint names is known of the other's too, opaque unless
    its own constraint gives it a type.
  - There is no arithmetic on lengths.
- **The clause is built to take more.** Candidates, each its own design:
  - **type equality,** `(X[keyof X] | Y[keyof Y]) == U`. Checked at each instantiation. In the
    body each side fits the other, which needs fitting under assumptions.
  - **narrowing a call guarantees,** as TypeScript's `x is T` results and Kotlin's contracts do.
    These are the callee's promises rather than the caller's requirements, the opposite direction
    to everything above, so whether they share `where` is decided with them.

### 5. Inference and variance

- **Inference through a mapping of a parameter's own keys.** Today a mapped type teaches
  inference nothing.
  - Relating a known product, a tuple or a struct, to `( [I in keyof A]: G<A[I]> )` or
    `{ [K in keyof S]: G<S[K]> }` binds `A` or `S` to a product of fresh variables, one per key,
    each related through `G` as variance says.
  - Every parameter whose keys a `where` ties to it is bound alike, so a mapping that also reads
    `B[I]` infers `B`.
  - So `all(fa, fb)` gives `A` its two elements from the futures' types, and a struct mapping
    infers its struct alike.
- **A rest relates its tuple element by element,** as any parameter relates its argument
  (proposal 11's packs as tuple-typed variables).
  - `run`'s functions bound `A`'s elements from above through their parameters, and its
    arguments bound them from below.
  - So `run(takeIntOrNone, printStr, 1, "a")` checks for `takeIntOrNone: fn(Int?) -> Unit`,
    while `run(printInt, printStr, "x", "a")` is reported.
  - Literals, joins and the expected type settle elements as they settle any variable.
- **Variance per element.** A mapping of a parameter's own keys passes the parameter on as `G`'s
  variance says, instead of making it invariant: `( [I in keyof A]: Array<A[I]> )` is covariant
  in `A`. Structs and tuples alike, so `struct Columns<gives A is tuple>` checks.

### 6. Entering a bracket

`testing.setups` combines "around" setups, `Setup<E> = async fn(async fn(E))`, the first
outermost. It looks like a fold: each step nests inside the last, and the environment's type
grows. But what nests is lifetimes, and an instance's executions express that with no
type-changing accumulator.

An instance runs its executions on one thread, in a deterministic order:
- calling an `async fn` runs the callee at once, up to its first `await`, which hands its future
  back to the caller (§3.3);
- a slot operation that can complete does so at once (§6);
- awaiting commits and resumes after every execution that became ready before it (§5, §6).

So a bracket can be left suspended inside its own callback, holding its frame and what it
prepared, while the caller goes on with its value. That is **entering a bracket**, as Haskell's
`managed` and Python's `ExitStack.enter_context` do. `enter` is a std function beside a general
`Bracket<E>`, which `Setup<E>` names:

```python
type Bracket<E> = async fn(async fn(E) -> Unit) -> Unit
struct Entered<E> { value: E, leave: async fn() -> Unit }

async fn enter<E>(bracket: Bracket<E>) -> Entered<E>:
    const value = Slot.create<E>()
    const done = Slot.create<Unit>()
    const run = bracket(async fn(v):              # runs at once, up to its first await
        await value.put(v)                        # fills the slot, then suspends: its first await
        await done.take())                        # waits here, holding the bracket's frame
    const v = await select:
        case value.read() as v: v
        case run: panic("The bracket ended without calling its callback.")
    Entered{
        value: v
        leave: async fn():
            await done.put(())                    # resumes the callback, then the bracket's teardown
            await run
    }

fn setups<A is tuple>(...each: ( [I in keyof A]: Setup<A[I]> )) -> Setup<A>:
    async fn(test: async fn(A) -> Unit):
        const entered = (for _, setup in ...each: await enter(setup))   # in order, first outermost
        await test((for _, e in ...entered: e.value))
        let leaves = [for _, e in ...entered: e.leave]
        leaves.reverse()                                                # innermost first
        for leave in leaves: await leave()
```

- **Order** is the call's. `enter` returns only once its bracket has called back, so the next one
  starts after it. Teardown runs innermost first, each finishing before the next begins.
- **Holdings** such as mocks live while their bracket is suspended.
- **Failure:** a bracket that never calls its callback ends its run first, and `select` turns
  that into a panic instead of a hang.
- **Leaving:** a bracket is entered once. An `Entered` released without `leave` releases its
  run, which is stopped at its `await` (§7): holdings are released, and code after the callback
  doesn't run.
- **Commits:** each `enter` and `leave` awaits, so it commits where today's nested `_joined`
  doesn't. Under proposal 8 it is an unmarked function, taking its caller's kind: in `live`
  code its waits don't commit, and in `ista` code each still does.
- **A named rest** (`setups(db: withDb, host: withHost)`) types the same way, but named
  arguments carry no order, so the nesting would follow name order instead of the call's.
  Positional stays.

### 7. Refinement by patterns

A second stage, built after §1–6. A pattern that succeeds teaches facts about the types it tested,
so a body can recurse over a product and still be checked once. `setups` keeps `enter` (§6); its
fold, written by recursion, shows what this checks:

```python
fn nested<A is tuple>(...each: ( [I in keyof A]: Setup<A[I]> )) -> Setup<A>:
    match each:
        case (): async fn(test): await test(())                # A is () here
        case (first, ...rest): async fn(test):                 # A is (A[0], ...T) here
            await first(async fn(x):
                await nested(...rest)(async fn(xs): await test((x, ...xs))))
```

- **The pattern walk is the one home.** Facts come wherever a pattern succeeds: a `match` case
  and its guard, and `x is P` in an `if`, a `while` or the right side of `and`. They hold exactly
  where its bindings do. So `if s is struct{meta, ...rest}: log(meta)` refines as a case does.
- **Shape facts refine the type parameter itself.**
  - `()` teaches that `keyof A` is `Never`. `(h, ...t)` teaches that `0` is a key, `h: A[0]`.
    `struct{meta, ...rest}` teaches that `"meta"` is a key of `S`; on an opaque `S` this is a
    test that can fail, where today it's refused.
  - Sound because a tuple or struct constraint stands for one product, never a union or `Never`,
    so each instantiation decides the pattern.
  - The parameter's key-equality class learns them too (§4), and so does a value of a mapping of
    its keys, as `each` above.
  - In the branch, result types and type `match`es over the parameter reduce by them, as a type
    `match`'s `case struct` already does for its case's type.
  - A mapping of `T`'s keys relates to a mapping of `A`'s through the same `G`, binding `A` to
    `T` (§5), so `nested(...rest)` infers.
- **Element tests narrow only binders.** In `case (h, ...t) if h is Awaitable`, `A[0]` may
  become a union, so the test picks members per value.
  - `h` gets the part of `A[0]` the pattern matches: a computed type that an instantiation reduces
    by today's member selection, the remaining type of §3.11 made lazy.
  - `A[0]` itself stays as it was. A result type that follows an element's type needs a test on
    types, a type `match`.
- **Trait names are patterns.** `h is Awaitable` matches a value whose type, or member, meets the
  trait, binding it with the trait known. Type `match`'s `infer T is C` is the same test on types.
- **A failed test teaches its complement.** Later cases and `else` learn "no key `meta`", "not
  empty" or "not `Awaitable`", as exhaustiveness already works out.
- **Facts end with their bindings.** An early exit, `if not (s is P): return`, teaches nothing
  after it, as today.
- **Spreads inside tuple types and values,** `(X, ...T)` and `(x, ...xs)`, are typed by segments,
  not arithmetic on keys:
  - a tuple type is a list of single elements and opaque spreads, normalized at construction: a
    known spread flattens;
  - a key is a segment and its key inside it;
  - mappings, field loops and comprehensions work per segment: one pass per single element, one
    "others" pass per spread;
  - two tuples have equal keys when their segments do, so `(X, ...T)` and `(...U, Y)` are never
    proven equal.
  - The tail of `(h, ...t)` is its own segment: `t: T`, keeping `T`'s keys. Renumbering `A`'s keys
    from `0` instead would let a loop over `t` read the wrong element of a tuple tied to `A`.
  - A rest takes single values beside a spread, and k tuple rests split the arguments into k runs
    alike: equal counts, single values and spreads at the same places, the spreads' keys tied.
    §3's two cases are this rule's runs of single values and of one spread.
- **Exhaustiveness:** an opaque tuple's cases are its lengths, as an `Array`'s are, so `()` and
  `(h, ...t)` cover it.
- **Still one pass, finitely instantiated.**
  - Each branch is checked once under its facts; a branch that contradicts known keys is ruled out
    (§3.11).
  - Each instantiation decides a shape test, so lowering emits only the branch that runs; an
    element test on a union runs as member selection does today.
  - The expansion rule accepts a recursive call on a strict tail as shrinking.

## Why

- **One machinery for products.** Proposal 4 built `keyof`, `S[K]`, mapped types, field loops,
  comprehensions and type `match` for structs. Variadic generics need exactly those operations by
  position. Swift's `each`/`repeat` would be a second way to map over a product, beside mapped
  types: a double standard, and F26's `each` with it.
- **This is TypeScript's model** (variadic tuple types, mapped types over tuples, inference
  reversing a mapping) **and Julia's** (varargs into a `Tuple`, keyword arguments into a
  `NamedTuple`). Field loops add what TypeScript lacks: each element checked at its own type.
- **Rests split by syntax.** Arguments bind to parameters before inference, by position and name.
  Equal keys keep that: the count alone splits several tuple rests. Splitting by types would make
  binding wait on inference, whose expected types (proposal 11) are what types the arguments.
  Lengths related by arithmetic split too, but tie no keys, so the body can't pair elements; no
  function needs them.
- **Named rests remove repeated defaults.** One options struct with its defaults serves every
  function taking it, and forwards unchanged.

## What changes in behaviour

- `<...A>` becomes `<A is tuple>`. `mock`, `calls` and `test/corpus/packs/` are respelled.
- Pack diagnostics 5080–5087 mostly become ordinary constraint and arity errors. 5083 goes: a
  tuple rest takes a whole tuple by its name.
- A field loop, comprehension, mapped type, `keyof` or `case tuple` over a tuple checks, where
  it's an error today.
- A comprehension over keys not all known, with nothing expected, is a mapping, where it reports
  5167 today.
- Calls through a mapping of a parameter's keys infer that parameter, where they ask for type
  arguments today.
- A rest's elements settle as any variable's: a call that converts an argument into its element's
  type checks, where exact binding refused it.
- A struct-constrained parameter's derived traits imply its fields' and back.
- `testing.setups` is one declaration over `enter`, replacing five overloads.
- With §7: recursion over a tuple checks; `struct{meta, ...}` on an opaque struct tests the field,
  where it's refused today; trait names are patterns; `(x, ...xs)` and `(X, ...A)` check, and a
  rest takes single values beside a spread.
- Programs that check today keep their meaning.

## What changes in power

| | pass-through | map through a type | constraint on every element | typed per-element loop | packs on types | two packs | folds, recursion | errors where declared |
|---|---|---|---|---|---|---|---|---|
| C++ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Scala 3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partly |
| TypeScript | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | types only | ✓ |
| Swift | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| **Ista** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ equal keys | ✓ by refinement (§7) | ✓ |
| Python 646 | ✓ | ✗ | ✗ | ✗ | ✓ | one per tuple | ✗ | ✓ |

Only Ista has these:
- the union of the elements, `A[keyof A]`, such as a `race` over mixed futures;
- key-typed members, `I in keyof A`;
- variance per element;
- one set of tools for structs and tuples.

**Still out: chains,** where an element's type depends on its neighbour's: `pipe(f, g, h)` needs
`fn(A) -> B`, then `fn(B) -> C`. Keys relate only by equality, never by position plus one.
Refinement (§7) checks such a body, but the chain's type needs a recursive type `match`, and a call
needs inference through one, which nothing does (Left for later). C++ and Scala check each
instantiation, and TypeScript falls back to overloads.

## Spec changes

- §2: `tuple` and `where` as contextual words.
- §3.1: keys, mapped types and comprehensions over tuples; comprehensions over unknown keys as
  mappings; derived traits of products.
- §3.3: rests (§3 above), the split, struct spreads and whole rests at a call.
- §3.5: packs rewritten as tuple constraints; `where`; inference through mappings; rests relating
  element by element; variance per element.
- §3.14: function types' trailing spreads; a named rest as one parameter.
- §3.15: tuples as products; `t[i]`, `t.0` through keys.
- §3.17: `case tuple`, `case fn(...infer A) -> infer R`.
- §3.11 (§7): facts from patterns, trait patterns, complements, opaque tuples' lengths in
  exhaustiveness; §3.15: spreads inside tuples by segments; §3.3: the split into equal runs.
- §4: field loops and comprehensions over tuples.
- §10: `setups` over `enter`, and `enter` itself.
- The cheat sheet and `guide.md`.

## Implementation notes

1. **Products by position (structural).**
   - `types/traits/struct-keys.ts`, already the one home for keys, reads a tuple's keys as `Int`
     literals in position order.
     - `KeysType`'s left-out names become keys, and its base (`union-members.ts`) is `Int` for a
       tuple and `String` for a struct.
     - `identity/type-keys.ts` spells `bigint` keys itself, since `JSON.stringify` throws on them.
   - `type-rules.ts` reduces a mapping of a tuple's keys to a tuple, and checks a mapping's key
     kind against its brackets.
   - Field passes (checker and lowering) and comprehensions accept tuples. The lowering's
     `FieldPassStep.field` holds a name or a position.
   - `t[i]` accepts tuples, and `t.0` (`literals/tuples.ts`) reads through `fieldTypeOf`.
   - Comprehensions over unknown keys infer their mapping (`struct-comprehensions.ts`).
   - A tuple comprehension node.
   - Type `match`'s `case tuple` and function spreads (`type-match-patterns.ts`).
2. **The tuple constraint (structural, removes code).**
   - The constraint model (`type/struct-constraint.ts`, `traits/known-constraints.ts`) gains a
     tuple form.
   - Derived traits of products both ways (`traits/sendable.ts`).
   - `isPack` and its special cases go: three copies of "fills a pack", two `packOf`s, three
     derivations of a rest's kind.
   - Runs in parallel with 1.
3. **Rests and `where` (behavioural).**
   - `FunctionType.pack` becomes trailing spreads, flattened when known as `withPack` does now.
     `relate.ts`'s "a function ending in a pack relates by equality" goes.
   - Binding (`resolution/choosing/binding.ts`, `arguments.ts`):
     - splits tuple rests by count;
     - routes a spread by its type;
     - gathers a named rest's arguments into the struct literal's check.
   - Lowering builds a named rest's struct in `calls/emit-call.ts`, beside parameters' defaults.
   - The `where` clause through parser, formatter, grammar and the constraint model. Key equality
     makes `keysOf` one type for both sides (`struct-comprehensions.ts`'s key check), and
     `struct-keys.ts`'s named-field lookup falls back to an opaque field for a key the other side
     names.
4. **Inference and variance (behavioural).**
   - `types/inference/` relates a product to a mapping of a parameter's keys, binding its
     key-equality class, and relates rests element by element.
   - `types/variance/usage-walk.ts` reads such a mapping per element.
5. **`enter` and `setups`** in std, once 1–4 land.
6. **Refinement (§7, behavioural), a second stage after 1–5.**
   - Tuple types hold segments (`type/index.ts`), normalized at construction; keys, mappings and
     field passes go per segment.
   - The pattern walk (`constructs/patterns/walk/`) records facts beside bindings, into one store
     scoped to a branch in the body context. Key reasoning, decided conditions and type `match`
     reduction read it; `where`'s key equality moves into it.
   - A computed type for a binder's matched part on an opaque type, reduced by member selection.
   - Exhaustiveness (`exhaustiveness.ts`) reads an opaque tuple's lengths as an `Array`'s.
   - The expansion rule (`rules/expansion/functions.ts`) accepts recursion on a strict tail.

Lowering is otherwise unchanged: a tuple is concrete once instantiated, and field loops already
unroll.

**Order:** after variance-inference's C3 and C4, which change the same computed types and
inference. Independent of proposal 8; before F28, since change 3 removes `relate.ts`'s pack case.

## Left for later

- **Chains** such as `pipe`: a chain type written as a recursive type `match`, and inference
  through one.
- Relations in `where` beyond key equality, narrowing guarantees (§4), and facts that outlive
  their bindings, after an early exit.
- A struct's first field by name order, for recursion over structs; field loops cover per-field
  work.
- Two named rests, even with disjoint fields.
- Partial type arguments at a call: a separate change.

## Open questions

1. **`testing.setups`:**
   - written once over `enter` (§6), replacing its five overloads. Recommended.
   - The alternative is keeping the overloads.

## Decisions (the human's)

1. **Tuples are built on top of structs:** products keyed by position, read by proposal 4's
   machinery. A pack is a type parameter constrained to tuples, superseding `<...A>` and F26's
   `each`.
2. **A struct may be a rest,** taking named arguments with its defaults.
3. **Several variadic tuples are allowed.** Used as rests together, their keys must be equal,
   and equality is the only relation: no length expressions.
4. **A variadic type parameter may be used several times,** even as two rests, which split
   evenly.
5. **Spellings:** a mapped tuple type is `( [I in keyof A]: G<A[I]> )`, and a tuple
   comprehension is `(for i, v in ...t: e)`.
6. **A `where` clause before the body's `:`** holds relations between type parameters, open to
   more relations later, such as type equality and narrowing after a call.
7. **Refinement by patterns** (§7), wherever a pattern succeeds, `x is P` being the `if` form:
   shape facts refine the type parameter, element tests only binders; failed tests teach
   complements; facts end with their bindings; spreads inside tuples are typed by segments.
