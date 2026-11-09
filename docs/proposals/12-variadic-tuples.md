---
description: proposal 12 of docs/proposals, for variadic type parameters as tuples — a tuple as a product keyed by position on top of proposal 4's struct machinery (`keyof`, `T[I]`, mapped types, field loops, comprehensions), a pack as a type parameter constrained to tuples, struct rests taking named arguments with the struct's defaults, several tuple rests when their keys are equal, and a `where` clause for relations between type parameters; supersedes the `<...A>` spelling and tracker F26's `each`, implements F3; read before designing or changing packs, rest parameters, tuples' keys or `where`
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-09
tags: [proposal, language, types, generics, tuples, packs, rests, f3, f26]
---

# Proposal: variadic tuples

A function or type can take any number of type arguments, each its own type, and map, constrain
and iterate them, with no mechanism of its own: a tuple is a product keyed by position, as a struct
is keyed by name, so proposal 4's computed types serve both.

## Example

```python
# Mixed-type futures: Future<(Int, String)> from a Future<Int> and a Future<String>
async fn all<A is tuple>(...fs: ( [I in keyof A]: Future<A[I]> )) -> Future<A>:
    (for _, f in ...fs: await f)

# zip of any number of arrays, each with its own type
fn zip<A is tuple>(...cols: ( [I in keyof A]: Array<A[I]> )) -> Array<A>:
    const n = [for _, c in ...cols: c.length()].min()
    [for r in 0..n: (for _, c in ...cols: c[r])]

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
  `keyof (Int, String)` is `0 | 1`, and `keyof ()` is `Never`. `T[I]` is the element's type,
  `t[i]` the element, a place, as a struct's `s[k]` is. `t.0` stays.
- **Every key-reading construct of proposal 4 takes a tuple,** visiting keys in position order
  where a struct's go in name order:
  - **field loops,** `for i, v in ...t:`, checked once per known position and once for the
    positions not known yet;
  - **array comprehensions,** `[for i, v in ...t: e]`;
  - **mapped tuple types,** `( [I in keyof A]: G<A[I]> )`: a tuple, one element per key. The
    parentheses mark the product, as braces mark a mapped struct type;
  - **tuple comprehensions,** `(for i, v in ...t: e)`, building one element per pass, as a struct
    comprehension builds a field;
  - **member parameters,** `I in keyof A`.
- **Spreads in tuple types.** `(X, ...A, Y)` splices a tuple's elements. A spread of a known tuple
  flattens where the type is built, so nothing downstream meets one. A function type's parameters
  are such a list: `fn(Int, ...A) -> R`.
- **A one-element tuple still converts** (§3.15), so a pack of one reads as its value.

### 2. A pack is a type parameter constrained to tuples

- **`A is tuple`,** beside `S is struct`. It takes a tuple constraint's entries, as a struct
  constraint takes fields:
  - `A is tuple { [_] is Stringable }` constrains every element;
  - `A is tuple { 0: Int, [_] is C }` also requires a first element, so a length of at least 1.
- **No separate kind of parameter.** `<...A>` is respelled `<A is tuple>`. The restrictions that
  existed only for packs go:
  - a pack may take constraints and a default (`A is tuple = ()`);
  - any declaration may have one (`struct Zip<A is tuple>`);
  - with a variance, written or derived (§5).
- **Opaque in a generic body,** as a constrained struct's other fields are. Its elements meet
  their constraint's entries; a field loop gives them one pass.

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
- **Several tuple rests** must have equal keys, so the positional arguments left split evenly.
  The keys are equal when the rests use the same pack, are mapped over the same keys, or a
  `where` says so (§4). With k rests and m arguments left, each takes m / k in order. A count k
  doesn't divide doesn't fit, as a wrong count doesn't today. So `run(printInt, printStr, 1, "a")`
  gives `fs` two and `args` two.
- **A positional rest and a named rest** take different arguments, so they stand together.
- **A named rest** builds its struct with the literal's rules:
  - a required field left out, a name it doesn't have, or a field given twice is an error;
  - a generic `S is struct` is the shape of the named arguments given;
  - its fields' names count as the function's parameters for choosing (§3.7).
- **At a call:**
  - `f(...t)` gives a tuple's elements by position;
  - `f(...o)` gives a struct's fields by name;
  - the rest's name takes a whole value, `get(url, opts: o)`, as an array rest takes a whole array.
- **Function types** have no names (§3.14):
  - a named rest is one positional parameter of its struct, `fn(String, RequestOptions)`;
  - tuple rests are spreads, `fn(...A, ...A)`, splitting as above.

### 4. `where`

- **A clause after a declaration's header, before its body,** holds relations between type
  parameters, joined by `and`:

  ```python
  fn pairs<A is tuple, B is tuple>(...a: A, ...b: B) -> ( [I in keyof A]: (A[I], B[I]) )
      where keyof A == keyof B:
  struct Zip<A is tuple, B is tuple> where keyof A == keyof B:
  type Pairs<A is tuple, B is tuple> where keyof A == keyof B = ( [I in keyof A]: (A[I], B[I]) )
  ```

- **One home for each kind of requirement:**
  - what one parameter meets stays on the parameter (`A is tuple & Sendable`), `&` joining what
    it meets;
  - a relation between parameters goes in `where`, `and` joining relations.
- **The relation, for now: `keyof X == keyof Y`,** over tuples or structs.
  - It is checked wherever the parameters get arguments, as a constraint is.
  - In the body it is a fact: `Y[I]` is defined for `I in keyof X`, and a field loop's key over a
    `X` value reads a `Y` value.
  - There is no arithmetic on lengths.
- **The clause is built to take more.** Candidates, each its own design:
  - **type equality,** `(X[keyof X] | Y[keyof Y]) == U`. Checked at each instantiation. In the
    body each side fits the other, which needs fitting under assumptions.
  - **narrowing a call guarantees,** as TypeScript's `x is T` results and Kotlin's contracts do.
    These are the callee's promises rather than the caller's requirements, the opposite direction
    to everything above, so whether they share `where` is decided with them.

### 5. Inference and variance

- **Inference through a mapping of a parameter's own keys.** Today a mapped type teaches
  inference nothing. Relating a known product, a tuple or a struct, to
  `( [I in keyof A]: G<A[I]> )` or `{ [K in keyof S]: G<S[K]> }` binds `A` or `S` to a product of
  fresh variables, one per key, each related through `G` as variance says. So `all(fa, fb)` gives
  `A` its two elements from the futures' types, and a struct mapping infers its struct alike.
- **A rest binds its tuple exactly,** as a pack does today. So `run`'s `args` and `fs` agree on
  `A`, and a mismatch is reported at the call.
- **Variance per element.** A mapping of a parameter's own keys passes the parameter on as `G`'s
  variance says, instead of making it invariant: `( [I in keyof A]: Array<A[I]> )` is covariant
  in `A`. Structs and tuples alike, so `struct Columns<gives A is tuple>` checks.

## Why

- **One machinery for products.** Proposal 4 built `keyof`, `S[K]`, mapped types, field loops
  and comprehensions for structs. Variadic generics need exactly those operations by position.
  Swift's `each`/`repeat` would be a second way to map over a product, beside mapped types: a
  double standard, and F26's `each` with it.
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

- `<...A>` becomes `<A is tuple>`. `mock`, `calls` and `test/corpus/packs/` are respelled. Pack
  diagnostics 5080–5087 mostly become ordinary constraint and arity errors.
- A field loop, comprehension, mapped type or `keyof` over a tuple checks, where it's an error
  today.
- Calls through a mapping of a parameter's keys infer that parameter, where they ask for type
  arguments today.
- Programs that check today keep their meaning.

## What changes in power

| | pass-through | map through a type | constraint on every element | typed per-element loop | packs on types | two packs | folds, recursion | errors where declared |
|---|---|---|---|---|---|---|---|---|
| C++ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Scala 3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partly |
| TypeScript | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | types only | ✓ |
| Swift | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| **Ista** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ equal keys | ✗ | ✓ |
| Python 646 | ✓ | ✗ | ✗ | ✗ | ✓ | one per tuple | ✗ | ✓ |

Only Ista has these: the union of the elements, `A[keyof A]` (a `race` over mixed futures);
key-typed members, `I in keyof A`; variance per element; one set of tools for structs and tuples.

**Brackets nest without recursion.** `testing.setups` combines "around" setups,
`Setup<E> = async fn(async fn(E))`, the first outermost. It looks like a fold: each step nests
inside the last, and the environment's type grows. But what nests is lifetimes, and concurrent
executions express that with no type-changing accumulator.

The reusable part is **entering a bracket**: running an around function in its own execution,
parked inside its callback, so its value can be used outside it until it is left. That is
Haskell's `managed` and Python's `ExitStack.enter_context`. It is a std function beside a general
`Bracket<E>`, which `Setup<E>` names:

```python
type Bracket<E> = async fn(async fn(E) -> Unit) -> Unit
struct Entered<E> { value: E, leave: async fn() -> Unit }

async fn enter<E>(bracket: Bracket<E>) -> Entered<E>:
    const value = Slot.create<E>()
    const done = Slot.create<Unit>()
    const run = bracket(async fn(v):              # its own execution
        await value.put(v)
        await done.take())                        # parked: holds what it prepared
    Entered{
        value: await value.read()
        leave: async fn():
            await done.put(())
            await run
    }

fn setups<A is tuple>(...each: ( [I in keyof A]: Setup<A[I]> )) -> Setup<A>:
    async fn(test: async fn(A) -> Unit):
        const entered = (for _, setup in ...each: await enter(setup))   # in order, first outermost
        await test((for _, e in ...entered: e.value))
        const leaves = [for _, e in ...entered: e.leave]
        leaves.reverse()                                                # innermost first
        for leave in leaves: await leave()
```

- Holdings such as mocks live while their bracket is parked. Order and teardown are as nested
  frames give them.
- **`enter`'s wait for the value** races the bracket's run, failing if the run ends first, so a
  bracket that never calls its callback, or fails while preparing, can't hang it. A bracket is
  entered once.
- **Under proposal 8,** `enter` waits through its one-shot resolvers rather than slots, in
  whichever kind its bracket is.
- **A named rest** (`setups(db: withDb, host: withHost)`) types the same way, but named
  arguments carry no order, so the nesting would follow name order instead of the call's.
  Positional stays.

**Still out: chains,** where an element's type depends on its neighbour's: `pipe(f, g, h)` needs
`fn(A) -> B`, then `fn(B) -> C`. Keys relate only by equality, never by position plus one.
Checking such a body once is induction over the length, which needs type parameters refined by a
`match` (below). C++ and Scala instead check each instantiation, and TypeScript casts in the
body.

## Spec changes

- §3.1: keys, mapped types and comprehensions over tuples.
- §3.3: rests (§3 above), the split, struct spreads at a call.
- §3.5: packs rewritten as tuple constraints; `where`; inference through mappings; variance per
  element.
- §3.14: function types' spreads; a named rest as one parameter.
- §3.15: tuples as products; `t[i]`; spreads in tuple types.
- §4: field loops and comprehensions over tuples.
- The cheat sheet and `guide.md`.

## Implementation notes

1. **Products by position (structural).**
   - `types/traits/struct-keys.ts`, already the one home for keys, reads a tuple's keys as `Int`
     literals in position order. `KeysType`'s left-out names become keys.
   - `type-rules.ts` reduces a mapping of a tuple's keys to a tuple.
   - Field passes (checker and lowering), comprehensions and `t[i]` accept tuples.
   - A tuple comprehension node.
2. **The tuple constraint (structural, removes code).**
   - The constraint model (`type/struct-constraint.ts`, `traits/known-constraints.ts`) gains a
     tuple form.
   - `isPack` and its special cases go: three copies of "fills a pack", two `packOf`s, three
     derivations of a rest's kind.
   - Runs in parallel with 1.
3. **Rests and `where` (behavioural).**
   - Tuple types hold spreads, normalized at construction, replacing `FunctionType.pack` and
     `withPack`.
   - Binding (`resolution/choosing/binding.ts`) splits positional rests by count and gathers a
     named rest's arguments into the struct literal's check.
   - Lowering builds a named rest's struct at the call, as it builds an array rest's array.
   - The `where` clause through parser, formatter, grammar and the constraint model, with key
     equality as a fact in bodies.
4. **Inference and variance (behavioural).**
   - `types/inference/` relates a product to a mapping of a parameter's keys.
   - `types/variance/usage-walk.ts` reads such a mapping per element.

Lowering is otherwise unchanged: a tuple is concrete once instantiated, and field loops already
unroll.

**Order:** after variance-inference's C3 and C4, which change the same computed types and
inference. Independent of proposal 8; before F28, since change 3 removes `relate.ts`'s "a function
ending in a pack relates by equality".

## Left for later

- **Type refinement by `match`** over a tuple or struct value (`case ()`, `case (h, ...t)`):
  - each branch learns its type parameter's form;
  - each instantiation recurses on a shorter tuple, so it ends;
  - it unlocks chains such as `pipe`, and belongs with the narrowing guarantees of §4.
- Relations in `where` beyond key equality, and narrowing guarantees (§4).
- Two named rests, even with disjoint fields.
- Partial type arguments at a call: a separate change.

## Open questions

1. **`testing.setups`:** written once, as above, replacing its five overloads. Recommended.
   The alternative is keeping the overloads.

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
