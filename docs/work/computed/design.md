---
description: design of the `computed` std library — derived values with dynamic dependencies, written in Istalang on proposal 13's transient variables and getters; dependencies checked by version on read, reads tracked on the stack through one non-generic `with`, no observers, no cycles in memory; and FormBuilder reshaped around it, its redraw loop, `unshow` and `Drawing` gone; read before implementing the library or the computed forms runtime
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [design, computed, reactive, forms, stdlib]
---

# Computed — design

**What it is:** a std module, `computed`, written in Istalang on proposal 13's transient variables
and getters (`docs/proposals/13-transients-and-getters.md`). It holds derived values with
dynamic dependencies, as in Knockout or Vue. Its first user is FormBuilder, which redraws its whole
tree on every event, up to eight times, until visibility settles (`forms.ista`'s `0..8` loop; its
spec lists the limit as an open point).

**What it gives:**
- an edit re-derives only what read the edited value;
- a hidden node's values are never read, so its fetches never start;
- an unchanged subtree is the same object as before, so the host gets stable references;
- a form whose conditions cycle is an error of its generator, naming the form nodes.

## The library

```python
struct Read:
    dep: Dependency
    version: Int                        # dep's version when it was read

shared struct Dependency:               # one per computed and per source; not generic
    version: Int = 0                    # bumped when its value changes
    reads: Array<Read> = []             # what its last evaluation read; a source reads nothing
    evaluated: Bool = false
    evaluating: Bool = false
    refresh: fn(Dependency) -> Unit     # takes its own Dependency, so it captures none

# Runs callback with ctx as the reader of everything read beneath it; gives it the reader around it.
fn with(ctx: Dependency, callback: fn(Dependency?) -> Unit):
    transient let current: Dependency? = none
    const outer = current
    current = ctx
    fn restore():
        current = outer
    _ = defer restore()
    callback(outer)

fn update(dep: Dependency):            # brings dep up to date, evaluating it only if it is stale
    if dep->evaluating: panic("a computed reads itself")
    if not dep->evaluated or dep->reads.some(fn(r): { update(r.dep); r.dep->version != r.version }):
        dep->evaluating = true
        dep->reads = []
        dep->refresh(dep)
        dep->evaluating = false
        dep->evaluated = true

struct Computed<T>:
    dep: Dependency
    value: Shared<T?>

fn computed<T>(eval: fn() -> T) -> Computed<T>:
    const value = new Shared<T?>{value: none}
    const refresh = fn(dep: Dependency): with(dep, fn(_): {
        const next = eval()             # every read in here is noted in dep
        if value->value != next: { value->value = next; dep->version += 1 }
    })
    Computed{dep: new Dependency{refresh}, value}

fn read<T>(self: Computed<T>) -> T:
    update(self.dep)
    with(self.dep, fn(outer): {
        match outer:
            case None: ()
            case o: o->reads = [...o->reads, Read{dep: self.dep, version: self.dep->version}]
    })
    self.value->value ?? panic("never evaluated")
```

A `Source<T>` is the same: a `Dependency` that starts evaluated, with a `set` that bumps its version
when its value changes.

**How it behaves:**
- **On demand:** nothing is evaluated until it is read, and reading checks first whether anything
  it read changed. Edits mark nothing.
- **Equal results stop the update:** a result `==` to the old one keeps the old object and doesn't
  bump the version, so readers further up don't re-evaluate, and the host receives the same object.
- **Open (tracker F33):** as written, `with` fails static lifetimes, since `refresh` is a plain
  `fn` field; the design must change how `refresh` is held.
- **No cycles in memory:** a `Dependency` holds only what it read, and `refresh` takes its own
  `Dependency` as a parameter instead of capturing it. So a computed holding a task's future passes
  the static-lifetimes rule (§7).
- **One `current` for every `Computed<T>`:** `with` is the one function with the transient, and it
  isn't generic, so every instance shares it.
- **Cycles are caught where dependencies are known:** the `evaluating` flag panics on a computed
  that reads itself, and FormBuilder's generator rejects a cycle among its `when`s before any code
  runs. Proposal 13 has no compile-time cycle check: every computed's refresh sits in the one
  non-generic `Dependency.refresh` field, so a check by code alone would see every graph as a
  cycle.

## FormBuilder on computeds

The generator emits the scope's data as getters, so a pasted expression's reads are tracked as it
runs. It emits each expression as a function of the scope:

```python
# supplier.gen.ista
struct CompanySeen:
    m: CompanyModel

fn get employees(self: CompanySeen) -> Int?: self.m.employees.seen()
fn get size(self: CompanySeen) -> String?: self.m.size.seen()

fn companySizeWhen(SupplierScope{data, ...}) -> Bool: (data.company.employees ?? 0) >= 10
```

```python
# forms.ista
shared struct Field<T>:
    value: Source<T?>                   # what the user entered
    shown: Computed<Bool>               # its `when`, built from companySizeWhen; true without one

fn seen<T>(self: Field<T>) -> T?: if read(self->shown): read(self->value) else: none
```

**The loop:**
1. Read the view, a `Computed<Node>`, and send it.
2. Wait for an event, or a run resolving.
3. Route a `Set` to its field's `Source`, and go round again.

**What changes:**
- **Removed:** the `0..8` loop, `unshow()`, the `Drawing` accumulator, `View.runs`, and tasks keyed
  by the whole scope.
- **Awaited props:** a computed starts its fetch when first read, and starts it again when what it
  read changes. A hidden field's computed is never read, so it never fetches. Replacing a run drops
  its future, which cancels it (§7). A run that resolves writes its `Source`.
- **Cycles:** a `when` that reads its own field, through other fields or not, is an error of the
  generator, which knows the fields each `when` reads, and names the form nodes.

## Where it lives

- **`src/stdlib/computed/computed.ista`:** the library, written entirely in Istalang, with no
  natives. It is listed in `std-sources.ts`.
- **`examples/FormBuilder/`:** `forms.ista` is rewritten on it, and `generate.ts` emits the getters
  and the expression functions. Its spec's §6.3 (the loop) and §10's "Bounded redraws" change with
  it.
- **It depends on proposal 13** landing first: transient variables and getters.
