---
description: the decided design for identity, variance and constraint-based inference — identity read off declarations (`shared`, `sendable`, `ephemeral` externs), variance derived or written (`gives`/`takes`), conversions composing inside value types, one constraint system per outermost expression with a fixed settling policy, the optional join, what it deletes, spec edits and acceptance examples; read before implementing, examining or changing any of it
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-08
last_updated: 2026-11-08
tags: [design, checker, inference, variance, conversions, lowering, f25]
---

# Identity, variance and inference — design

Decided by the human on 2026-11-08; the plan is `plan.md`. This replaces tracker F25's options
and the analysis in `docs/work/proposals/f25-expected-type-first.md`.

**Goals, in priority order:**
1. Nothing surprises a user coming from TypeScript, Kotlin, Swift, C# or Rust.
2. Nothing that can be inferred has to be written.
3. Room for variadic type parameters (`each`) and proposal 8's function kinds.

## 1. Identity and reach, read off declarations

Two independent properties of a type:

- **Identity.** A value has none: copying shares an immutable value, and `==` is structural. A
  handle has one: copying copies a reference to one heap object, `==` compares that identity, and
  `const` stops there.
- **Reach.** How far a value travels: `ephemeral` (stays in process memory) < unmarked (persistable:
  survives commits, stays in its instance) < `sendable` (leaves the instance).

| Declaration | Identity | Reach | Prelude and std today |
|---|---|---|---|
| `struct`, `enum`, tuple, shape, union, function type | none | the minimum of its parts (a closure's: its captures') | — |
| `shared struct` | instance | persistable when its fields are | `Shared`, `Inbox`, `rpc.Method`, `fanout.Bus` |
| `extern struct` | none | from its type arguments | `Array`, `Map`, `Decimal`, `Zone` |
| `extern shared struct` | instance | persistable | `Slot`, `Future`, `WeakRef`, `_Cell`, `Mock` |
| `extern sendable struct` | global (a runtime or host id) | sendable | `Instance`, a host `Queue` |
| `extern ephemeral struct` | process | ephemeral | none until proposal 8 |

Rules:

- On an extern, `shared`, `sendable` and `ephemeral` pick one kind of handle. An extern with none
  of them is a value.
- An extern value is sendable when its type arguments are, since it crosses as JSON. So `sendable`
  never needs writing on a value, and writing it there now means "a handle with global identity".
- A disposable host type (§3.6, `dispose` declared beside it) has identity, so it must be declared
  as a handle.
- Everything that today recognises a handle by name reads the declaration instead:
  - `isHandle` in `rules/testing.ts`, which names `Slot`;
  - the identity part of lowering's extern roles (`lowering/tables/type-table.ts`);
  - sendability (`types/traits/sendable.ts`).

  Roles that pick a runtime native (`future`, `instance`, `cell`) stay as they are.

## 2. Variance

A type parameter of a declaration is **covariant**, **contravariant** or **invariant**. It is
derived for source declarations and written for externs. It is memoized per declaration, and a
recursive declaration's is iterated to a fixpoint.

- **Derived** from where the parameter occurs in a value type's fields, variants and type
  arguments:
  - a field position is covariant;
  - a function type's parameter flips the direction;
  - a position inside a handle's type arguments, or behind `&`, is invariant;
  - a parameter that never occurs is covariant.

  So `Inbox<T>` is invariant because it is a `shared struct`. A plain struct holding a
  `Slot<T>` would come out invariant too.
- **Every field of a `shared struct` is invariant,** because `->` reads and writes its cell.
- **Written, on externs:** `<gives T>` is covariant, `<takes T>` is contravariant, and nothing
  written means invariant.
  - The words are contextual, prefixing a PascalCase name, the slot a future `each` will share:
    `<gives each A>`. Writing both on one parameter is an error.
  - **Meaning:** no operation puts a `T` into an existing value of the type (`gives`), or takes one
    out of it (`takes`). Values satisfy `gives` by immutability: any change builds a new value in a
    `&` place, whose type is fixed. On an extern value, `gives` is the runtime's promise that it can
    rebuild the value at a wider type argument.
  - **On handles:** allowed only once view handles exist (tracker F27). Until then a marker on a
    handle is an error, and every handle is invariant.
    - **The rule, once allowed (C#'s):** every function in the declaring module that takes the
      handle uses `T` only in outputs for `gives`, or only in inputs for `takes`. An output is a
      result, or a parameter of a callback it is given: `subscribe(self: Bus<T>, handler: fn(T))`
      flips twice, so `T` is an output there.
    - **Checking the declaring module is enough:** code elsewhere can put a `T` into the handle
      only through that module's operations.
  - **On an extern value, `gives` constrains no signature.** A by-value argument that arrives
    converted has been rebuilt, and a `&` never converts, so `push(&Array<T>, T)` stays safe. The
    promise binds the implementation: the runtime rebuilds the value, and host natives already
    decode `T` per call's instantiation.
  - **On source `struct`s and `enum`s:** optional, as an assertion the compiler checks against the
    derived variance, as proposal 8 checks `readonly` on non-externs. Not allowed on a
    `shared struct`.
- **Prelude:** `extern struct Array<gives T>`, `extern struct Map<gives K, gives V>`.
- **Function types:** parameters are contravariant, the result covariant. Proposal 8's qualifiers
  are ordered among themselves (§7).
- **Traits, through `any Trait<T>`.**
  - A trait's type parameter is derived from its requirement signatures by C#'s interface rule:
    covariant when `T` occurs only in outputs, contravariant when only in inputs, else invariant.
  - `self` passed by `&` counts as an input of everything the requirement takes.
  - The strict rule is needed because the value inside an `any` keeps its own concrete type, so it
    can't be rebuilt at a wider argument as an `Array` can.
  - A trait has no markers: it's always derived.
- **Aliases are transparent:** an alias has its body's variance.
- **Constraints (`is Trait<X>`) stay exact,** with no variance.
- **A generic function's own type parameters have none.** Each call solves them, and nothing
  compares `f<A>` with `f<B>`. The solver reads only the variance of the types in the signature.
  Generic functions also do what use-site variance does elsewhere (Java's wildcards, Kotlin's
  `Array<out T>`): `fn read<T>(s: Slot<T>) -> T` takes any slot.

## 3. Conversions inside types

The fit relation (`types/fitting/fit.ts`) keeps every conversion it has today:
- into an `any` type;
- a struct's value into its shape;
- a plain function made async;
- between a one-element tuple and its element;
- a literal to its base;
- into a union.

It composes them through variance: `X<A>` fits `X<B>` when `A` fits `B` (covariant), `B` fits `A`
(contravariant), or they are the same type (invariant).

- **A reference never converts** (§3.7), and neither does anything inside a handle.
- **What it allows:**
  - `Array<Int>` fits `Array<Int?>`;
  - `Box<"s">` fits `Box<"s" | "m">`;
  - `fn(Int?) -> Int` fits `fn(Int) -> Int?`;
  - `Slot<Int>` never fits `Slot<Int?>`.
- **Lowering** (`lowering/functions/fits.ts`) converts a value only where the representation
  changes:
  - Unions are tagged, so `Int` into `Int?` wraps.
  - Nested conversions rebuild:
    - the elements of an `Array` or `Map`;
    - the fields of a struct, an enum's variant or a tuple;
    - a function, wrapped as the async fit already is.
  - A host payload (`{kind: 'extern', payload}`) is left unchanged: widening keeps its JSON valid
    for the wider type, and the host decodes it later. The one gap is the open question of union
    JSON (spec §13).
  - A rebuild is O(size), as Swift's implicit collection conversions are; the settling policy
    (§4) makes most values be built at the target type, so few are needed.
- **Overloads: "most specific" replaces the clash between a type and a union holding it.**
  - Among applicable candidates, one whose parameter types all fit another's wins, as in C#,
    Kotlin and Java.
  - Today, `fn f(x: Int)` and `fn f(x: Int?)` clash because nothing could rank them. Conversions
    inside types would make `fn f(xs: Array<Int>)` and `fn f(xs: Array<Int?>)` overlap the same
    way, so one rule now covers both: the pairs may coexist, and `f(1)` and `f([1])` take the
    first.
  - Two functions still clash when some call fits both and neither is more specific: equal
    parameter types, as today.
  - A conversion inside a type counts as a conversion in the existing "takes every argument as it
    is" rank.
- **Witnesses keep `self` exact.** `Array<Int>` doesn't meet a trait through a function declared
  for `Array<Int?>`; otherwise how a type meets a trait would depend on the conversions where it is
  used (§3.10's coherence).

## 4. Inference: one constraint system per outermost expression

Each generic call, generic struct literal and variant call gets type variables for the function's
type parameters. Constraints come from three places:

- **Arguments:** an argument's type must fit its parameter's type. Decomposing by variance gives
  lower bounds (covariant), upper bounds (contravariant) and equalities (invariant, `&`, written
  type arguments, packs' exact items).
- **The expected type:** the result must fit the expected type, decomposed the same way.
  - Against a union, it is decomposed against the one member the result's head can be.
  - If several members could be, it is decomposed against the one whose bounds the arguments
    satisfy (the variant rule, generalised).
  - Otherwise it gives nothing.
- **Constraints of the declaration** (`is`, `in`) are checked once a variable is settled, as
  today.

**Joint solving.** A nested generic call, or generic literal, in argument position doesn't settle
alone. Its variables join the enclosing call's system, and the outermost expression settles them
all, as Kotlin's inference does. Node types recorded meanwhile stay pending until then.

**Choosing doesn't change.**
- Candidates come from the arguments, as today, with argument-dependent lookup and requirement
  candidates.
- Applicability uses the argument constraints only, never the expected type, so §3.7's "Return
  types play no part" stays true.

**Postponed arguments.** These need their parameter types before they can be checked:
- a lambda with an untyped parameter;
- a function named as a value;
- a bare variant;
- `none`;
- `[]`;
- an overloaded name.

They are checked once the variables in their parameter's *inputs* are settled. A lambda's or
function value's result then adds lower bounds. This repeats until every postponed argument is
checked; then the rest is settled.

**The settling policy**, for each variable, in order:
1. **An equality,** if there is one. Several equalities must agree.
2. **The expected type's choice, inside the result.** When the variable sits inside the result (a
   type argument, an element, a part of a function type), the expected type gives it an upper bound
   `B`, and every lower bound fits `B`: settle on `B`. Values are then built at the target type,
   with no rebuild.
3. **The common type of the lower bounds,** which must fit every upper bound:
   - one of the lower bounds that all the others fit;
   - else `T` together with `None` gives `T?` (§5);
   - a fresh literal type is widened to its base unless an upper bound holds a literal type of
     that base.
4. **The upper bound:** a union is allowed, because it is written.
5. **The default.**
6. **Otherwise** 5100, cannot infer.

At the top of the result (the result itself, or a member of a result union), rule 2 doesn't
apply: the call's value converts there. So `biggest(a, b)` as an `Int?` gives `T = Int`.

**Literals are fresh.** While a system is open, a literal has its literal type. Rule 3 decides
whether it widens, which is §2's existing rule ("its literal type where a literal type of its base
is expected") expressed as a bound.

**Diagnostics.**
- No candidate takes the arguments: 5002, as today.
- The expected type's bounds conflict with the arguments': the call is settled without them, and
  the result is judged against the expected type as any value's is (5001 at the call, as today).
- Conflicting equalities or lower bounds: 5100 or 5001, as today.

**Packs** are tuple-typed variables, and tuples are covariant, so their bounds compose element by
element.

## 5. The optional join

Producers that must agree (`rules/agreement.ts`: an `if`'s branches, a body's tail and its
`return`s, a collection literal's items), and rule 3 above, share one `commonType`. It accepts
exactly two joins: a literal type into its base (today's widening), and a type with `None` into its
optional.

- `if c: 1 else: none` is an `Int?`, and so is `[1, none]`'s item type, as in Kotlin, Swift and C#.
- `if c: 1 else: "a"` stays an error: no other union is ever inferred.

## 6. What it deletes

| Home | Replaced by |
|---|---|
| `resolution/calls/known-parameters.ts`, `calledConstructor`'s use in `constructs/expressions/calls.ts` | Variants are ordinary generic calls (§4) |
| `expectedArguments`, `instanceTaking` in `constructs/expressions/structs/variants.ts` | The expected type's decomposition against unions (§4) |
| The expected step in `resolution/conformance/conformance.ts` `instantiateAt` | The settling policy |
| The ordering logic of `resolution/calls/function-arguments.ts` | Postponed arguments |
| §3.7's literal building: `buildsOf` and its handlers (`constructs/expressions/expressions.ts`, `structs.ts`), `builds` in choosing's applicability, the rebuild of literal producers in `agreement.ts` | Conversions inside types (§3) |
| "Only the top converts" special cases in `types/inference/infer.ts` and `types/fitting/fit.ts` | Bounds and variance |
| The name-based handle checks (§1) | Identity from declarations |

## 7. Hooks for what comes later

- **`each` (tracker F26):** `<each A>` replaces `<...A>` in declarations. It shares the prefix
  slot with `gives` and `takes`, and the solver already treats a pack as a tuple variable.
- **View handles (tracker F27):** they let `gives` and `takes` apply to handles. A converted
  handle becomes a view that converts each value as it leaves (or enters), with `==` comparing the
  underlying object. Candidates: `Future<gives T, K>`, `Instance<gives T>`, `WeakRef<gives T>`,
  proposal 8's `Resolver<takes T, K>`.
- **Proposal 8 (tracker F28):**
  - The function-type qualifiers become subtyping: `sendable fn` ≤ `fn` ≤ `ephemeral fn`,
    `readonly fn` ≤ `fn`.
  - `fn(A) -> R` ≤ `fn(A) -> Future<R, K>` is the async fit.
  - `Future<T, K>` is invariant in `K` ("the kinds never meet").
  - Qualifier variables later give qualifier-preserving higher-order functions, such as `logged`
    keeping `sendable`, with no new syntax.

## 8. Spec edits

| Section | Edit |
|---|---|
| §2 Unions | "The conversion takes a whole value, once, never inside another type": conversions compose through variance (§3.5), never through a reference or into a handle. "Never inferred": add the optional join |
| §2 Value semantics, §3.1 Sendable types | Identity and reach as in §1; extern values are sendable when their type arguments are |
| §3.5 Generics | Inference as constraints: arguments and the expected type give bounds; the settling policy; variance (derived; `gives`/`takes` on externs); packs as tuple variables |
| §3.6 Extern declarations | The four extern kinds; disposable host types are handles; the `Queue` example becomes `extern sendable struct` with its new meaning |
| §3.7 Methods | Delete the literal-argument bullet. Add the "most specific" rank. Replace "a type counts as the same as a union holding it" in the clash rule with "neither is more specific". Keep "Return types play no part" (in choosing) |
| §3.10 Traits | A trait's type parameter, through `any`, is derived by C#'s rule from its requirements. A witness takes `self` exactly, with no conversion |
| §3.8 Prelude | The type table shows `Array<gives T>` and `Map<gives K, gives V>`, and the handle kinds |
| §3.11 Enums | A variant's call is an ordinary generic call: drop "the expected type's when it is the same enum, are given before the arguments" |
| §3.14 Function types | Lambdas and functions named as values are postponed arguments; function types' variance; the async fit composes |
| §3.18 Shared structs | Invariant in every type parameter |
| §4 Branches | "All their branches must have the same type": they agree through `commonType` |

## 9. Acceptance anchors

| Program | Today | After |
|---|---|---|
| `const b: Array<Int?> = a` for `a: Array<Int>` | 5001 | checks, runs |
| `const t: Slot<Int?> = s` for `s: Slot<Int>` | 5001 | 5001 |
| `pair(1, 2)` as `Array<Int?>`; `single(5)` as `Box<Int?>` | 5001 | checks (rule 2) |
| `vs.map(Result.Ok)`, `vs.map(fn x: Result.Ok(x))`, `vs.map(fn x: Ok(x))` as `Array<Result<Int, String>>` | 5001, 5001, 5107 | check |
| `items([Item{value: "s"}])` as `Options<"s" \| "m">` | 5001 | checks (joint) |
| `items([Item{value: Small}])` with `Small` a bare variant | 5107 | checks (joint, postponed) |
| `pick("draft", "sent")` as `Status` | 5001 | checks (rule 4) |
| `biggest(a, b)` with `T is Comparable`, as `Int?` | checks | checks, `T = Int` |
| `fields.get(k)` as `Json` | checks | checks, `V = Json` |
| `pairWith(item, "cents")` through `T is Pairable` | checks | checks |
| `Ok(5)` as `Result<Int?, String>`; `Ok(Expired)` as `Result<Decision, E>` | checks | checks, with no variant special case |
| `if c: 1 else: none`; `[1, none]` | 5001 | `Int?`, `Array<Int?>` |
| `if c: 1 else: "a"` with no expected type | error | error |
| `show(5)` with `show<T>(x: T)` and `show(x: Int)` | concrete | concrete |
| `fn f(x: Int)` beside `fn f(x: Int?)`; `f(1)` | clash | coexist; takes `f(x: Int)` |
| `any Source<Int>` into `any Source<Int?>`, where `Source<T>` only gives `T` | 5001 | checks |
| `any Sink<Int>` into `any Sink<Int?>`, where `Sink<T>` takes `T` | 5001 | 5001 |

## 10. Risks

- **Hidden O(n) rebuilds.** Rule 2 builds most values at the target type. Profile `fb-warm` and
  `std-tests` (`npm run profile:check`) in each behavioural phase.
- **Pending node types (joint solving).** This touches what `BodyContext` records. It lands
  structural-first in its phase, with nothing observable changing.
- **Variance on recursive types.** It needs a fixpoint, guarded like proposal 5's identity: pin
  `Json`, `Tree` and the form builder's recursive aliases in tests.
- **Error drift.** Diagnostics keep today's codes and positions by design (§4). The corpus's stated
  errors are the regression net.
