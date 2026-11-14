---
description: design of FormBuilder's `computed` module — a graph of sources and computeds on one monotonic clock, each computed evaluated at most once per view and only when a dependency changed, a self-read giving the previous value, all simple Istalang on proposal 13's transients and 14's inert functions; where its state lives and what the host sees of it; and FormBuilder rebuilt on it as a simple core driven by two live functions, the browser's and the backend's validation; read before implementing the module or the computed forms runtime
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [design, computed, reactive, forms]
---

# Computed — design

**What it is:** a module of the FormBuilder example, `computed`, written in Istalang with no
natives, on proposal 13's transient variables (`docs/proposals/13-transients-and-getters.md`) and
proposal 14's inert functions (`docs/proposals/14-inert-functions.md`). It holds derived values
with dynamic dependencies, as Knockout or Vue do, in simple code. FormBuilder's core becomes simple
code on it, driven by two live functions. Nothing in it is async.

**What it gives:**
- **Once per view:** a view is one outermost `read`. Every computed read in it evaluates at most
  once, and every later read in the view gives that result as it is, the same object.
- **Only what changed runs:** a computed re-evaluates only when a dependency changed since it was
  last brought up to date, and a result `==` to the old one keeps the old object.

## The module

```python
shared struct Graph:                   # nodes that read one another, on one clock
    now: Int = 0                       # monotonic: ticks at every view and every change

shared struct Dependency:              # one per source and computed; not generic
    graph: Graph
    changed: Int = 0                   # the tick its value last changed at
    checked: Int? = none               # the tick it was last brought up to date at; none: never
    reads: Array<Dependency> = []      # what its last evaluation read, in order
    active: Bool = false               # being brought up to date or evaluated
    refresh: inert fn(Dependency) -> Unit

fn source<T is Inert>(self: Graph, value: T) -> Source<T>
fn computed<T is Inert>(self: Graph, eval: inert fn() -> T) -> Computed<T>
fn set<T is Inert>(self: Source<T>, value: T)          # between views
fn read<T is Inert>(self: Computed<T>) -> T            # and the same on a Source
```

**How it behaves:**
- **One clock per graph:** an outermost `read` ticks it and makes the tick its view, and a value
  changing ticks it and stamps the node `changed` with the new tick. So a node with
  `checked >= view` is up to date in this view.
- **Reads are tracked on the stack:** one non-generic function holds the transient (§3.4) with the
  view and the current reader, so every `Computed<T>` shares it. Every `read` enters through it,
  bringing the node up to date and recording it in the reader alike, so an outermost read's
  transient lasts the whole view. A view reads one graph: reading another graph's node in it
  panics, since their ticks don't compare.
- **Bringing a node up to date:** one up to date in this view returns at once, so each is visited
  once per view. Otherwise it evaluates if it never did, or else its reads are brought up to date
  in the order they were read, stopping at the first whose `changed` is after its `checked`, which
  re-evaluates it. So reads behind a condition that flipped are never brought up to date, and a
  hidden node's expressions don't run. Then `checked` becomes the current tick.
- **Equal results stop the update:** a result `==` to the old one keeps the old object and leaves
  `changed`, so readers above don't re-evaluate.
- **A computed reading itself,** directly or through others, gets its previous value: a node
  reached again while `active` is recorded but not brought up to date, and gives its value as it
  is. Whatever read that old value was checked before the node's new `changed`, so the next view
  re-evaluates it. During its first evaluation it has no previous value, so that read panics.
- **`none` is a value:** a computed of `T?` may give `none`; "never evaluated" is
  `checked == none`, and the cell wraps `T` so it never needs `none` for it.
- **Writes happen between views:** only the driver sets sources, never an evaluation. This is
  assumed, not checked.
- **Memory:** cycles in the graph are allowed, since all of it is inert (proposal 14): the
  `refresh` and `eval` closures, the values and the scopes they read.

## Where the state lives

- **In the locals of a running live function:** the graph and its nodes are shared structs on the
  interpreter's heap. No global holds them: top-level constants are compile-time values (spec §3).
  In the browser, the host starts the serving function once, as a live run in the Web Worker that
  runs the interpreter, and that run keeps its locals in memory across its awaits of the
  next-event extern, for the whole session. The backend's validation builds a graph per call and
  drops it when it returns. The host holds nothing but the JSON it is sent.
- **The same object inside the interpreter:** values are immutable and shared (spec §3.1; the
  Definition's values), so a cached result read again is the very object, never a copy.
- **Not at the host:** every value crossing to a host is JSON, encoded by the extern's wrapper at
  each call (`docs/arch/boundary.md`), and the Worker's message to the page is cloned again. The
  page gets new objects for every tree. The FormBuilder spec's claim that the bridge keeps a shared
  struct's JavaScript reference (§3, §8) describes no existing feature. This work sends new
  objects; stable references come with proposal 15 (`docs/proposals/15-stable-host-references.md`).

## FormBuilder on computeds

**Expressions are simple.** The generator emits the scope's data as getters, so an expression's
reads are tracked as it runs, and each expression as an unmarked function of the scope:

```python
fn get employees(self: CompanySeen) -> Int?: self.m.employees.seen()
fn companySizeWhen(SupplierScope{data, ...}) -> Bool: (data.company.employees ?? 0) >= 10
fn creditLimitDefault(SupplierScope{data, ...}) -> Int: crm.creditLimit(data.company.vatId ?? "") ?? 0
```

- **Everything an expression calls returns at once.** Sources are unmarked `extern fn`s the host
  implements; examples and tests mock them. `await runtime.delegate f(args)` in a form's JSON
  becomes `f(args)`, and the generator no longer looks for `await`.
- **No `pending`:** nothing waits, so the schema's `pending`, the `Loading` node and rules run
  after submit are gone (spec §4.3). The supplier form's approval rule becomes an ordinary rule
  calling a simple extern.
- **Scopes:** scope variables (`data`, a nested group, a repeat's or variant's binding, a mounted
  form's params) are generated structs with getters, so reads are tracked field by field. A node's
  `Seen` stays the plain shape, which shape conversions, `load`, `rowKey` and hand-written
  functions take; getters don't convert (proposal 13).
- **The model pulls:** every derived model value is a computed, never a write during a view: a
  field's value (entered, else its default or computed expression), a `Hidden`'s `shown` (any of
  its writers visible), and computed rows and tags. Only events set sources.
- **The views bind their scope when built:** each expression is a closure over its scope, made
  once, so views take no `Sc` parameter and there is no `ScopedView` or `any View<Sc>`. A view node
  is a `Computed<Node>` with its validity, everything it holds is inert, and the root gives the
  tree and whether the form is valid. One `Graph` per form.
- **Removed:** the `0..8` loop, `unshow()`, `Drawing`, `View.runs`, `Task`, `Check.Later` and every
  `ista` mark.

**Two live functions:**
- **The browser's** serves a form from the frontend's events: for each, set its source, read the
  root, send the tree; a valid submit sends the form's value to its host and returns. The host
  starts a function with JSON arguments and disposes what it holds when it returns, so the graph
  lives as long as this loop. An `Inbox` is ista, so events and trees cross through host externs
  instead: a `live async` one giving the next event, and a `live` one taking a tree. Tests mock
  them as they mock the sources.
- **The backend's** validates a whole value: build the model from it, mark it submitted, read once,
  and give the typed `Data` or the errors by node key. Values the value holds for hidden nodes are
  dropped, as hidden nodes don't exist. Workflows will call it through `delegate`,
  which is not part of this work.
- **No replay:** the backend validates the value it receives instead of replaying the event log.

## Where it lives

- **`examples/FormBuilder/computed.ista`,** with `.ista` tests beside it.
- **`examples/FormBuilder/`:** `forms.ista` rewritten; the sources made simple externs;
  `generate.ts` emitting getters and expression functions, with `pending` gone from `form-spec.ts`;
  the forms' JSON; and its spec's §3, §4, §5, §6, §7 and §10.
