---
description: proposal 13 of docs/proposals, two language additions — `transient let` variables, one value per outermost call shared by a function's nested calls, and getters, methods annotated `@Getter` and read as fields; their rules, lifetimes, lowering and spec edits; read before designing or implementing either, or code that needs recursion-scoped state or values computed from fields
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [proposal, language, getters, transient, variables]
---

# Proposal: transient variables and getters

**Motivation.**
- Some state belongs to a recursion, not to one call nor to the program: a memo table, a depth
  counter, the reader a nested read reports to. Today it is threaded through every call's
  parameters, or it can't be written at all where the calls pass through code that doesn't know
  about it.
- Some values are computed from fields but should read as fields, for example a scope that an
  expression reads as `data.company.size` while the scope decides what that read does.

Both come up in reactive code (computeds with dynamic dependencies, `docs/work/computed/design.md`),
which these two additions make writable as an ordinary library. Neither addition is specific to it.

The human chose the design and the decisions at the end. Section numbers refer to `docs/spec.md`.
The plan is `docs/work/transients-getters/plan.md`.

## Transient variables

```python
fn paths(n: Int) -> Int:            # ways up n stairs, one or two at a time
    transient let memo: Map<Int, Int> = [:]
    if n <= 1: return 1
    if memo.has(n): return memo[n]
    const total = paths(n - 1) + paths(n - 2)
    memo[n] = total
    total
```

The memo lives from the outermost `paths` call until that call returns, and every nested call
shares it, so the recursion is linear. The next top-level call starts with an empty one. There is no
global state, and nothing is threaded through parameters.

**The rules:**
- **A modifier of `let`,** as `hold` is: `transient let name[: T] = initializer`. Any function
  may declare one, of any mark, async or not.
- **At the top of a function's body,** before its other statements, so every call has it before
  it calls anything, and its function's return is what ends it.
- **One value per outermost call.** The outermost active call of the function makes it from its
  initializer. Every call nested inside it, directly or through other functions, shares the same
  variable.
  - An async call nested in it is nested too: its execution keeps the transients visible where it
    was called, even once the outermost call has returned. A spawned instance or a delegated job
    runs in another instance, so it starts fresh.
- **One per generic instance.** `f<Int>` and `f<String>` are separate functions (§3.5), each with
  its own. Code that must share one across instances routes through a non-generic function:

  ```python
  fn nested(callback: fn(Int) -> Unit):   # not generic, so every caller shares one depth
      transient let depth = 0
      depth += 1
      _ = defer(fn(): depth -= 1)
      callback(depth)

  fn render<T>(node: Tree<T>) -> String:  # each instance of render reaches the same depth
      let out = ""
      nested(fn(depth): out = `${"  ".repeat(depth)}${node.label}\n${node.children.map(render).join("")}`)
      out
  ```

- **Written like `let`:** assigned, written through `&`, and captured by closures as a cell
  (§3.14).
- **Its initializer runs only at the outermost call,** so it can't read the function's parameters
  or locals; it may name the function's type parameters. Its type may be left out, as a `let`'s
  may.
- **Lifetimes:** the outermost call's frame holds the value, nested frames share its cell, and so do
  the async calls nested in it. It is released when the last of them ends (§7). In ista code it
  persists with them.

## Getters

```python
struct Person:
    first: String
    last: String

@Getter
fn full(self: Person) -> String: `${self.first} ${self.last}`

const ada = Person{first: "Ada", last: "Lovelace"}
ada.full                    # "Ada Lovelace", computed on every read; the call full(ada)
```

**The rules:**
- **A method annotated `@Getter`,** the prelude's field-less annotation (§3.16). It takes exactly
  one parameter, `self`, by value. It is not async, and it may be generic.
- **Read with `.`, as fields are:** `x.g` is the call `g(x)`, on any type, a shared struct's handle
  included (`lease.g`, as methods are called, §3.18); `x?.g` reads it in an optional chain.
  `x.g(…)` calls the value it gives, as for a field holding a function. Called as a plain function,
  `g(x)`, it is the method it is.
- **One meaning per name:** on a type, a name is a field, a getter or a method, never two; a use
  that finds two is a compile error, as a field and a method of one name are today.
- **Never stored:** a literal never sets a getter, and nothing assigns one or takes its `&`. `==`,
  hashing, the JSON codecs, struct patterns, `keyof`, spreads, field loops, shapes, struct
  constraints and trait field requirements see the stored fields only, so `ada == Person{first:
  "Ada", last: "Lovelace"}` holds.
- **Found like methods,** by the type of `self`, so a module may declare getters for types it
  imports. A trait requirement is never a getter.
- **No cycle check.** A getter that reaches itself is recursion, as a method's is.

## What it takes

- **`transient let`:**
  - a contextual word before `let`, parsed as `hold` is;
  - one IR instruction, `transient dst, target`, which shares the cell of the nearest enclosing
    call of the same function, or goes on to the initializer, whose write makes the cell as any
    cell variable's first write does;
  - no table: the value lives in frame registers and the cells they share, which snapshots already
    persist, and an execution keeps the transient cells visible where it started, one persisted
    field.
- **Getters:** the prelude's `Getter` annotation, and resolving a member read with no stored field
  to a getter, checked and recorded as the call; the IR doesn't change.

**Spec edits:**
- §3.1: getters replace "No getters or setters".
- §3.4: `transient let` variables.
- §3.16: `Getter` among the annotations the compiler reads.
- §3.18: `.` on a handle reads its getters as it calls its methods.
- §7: a transient value is held by the outermost call's frame.

## Decisions

- **Transient values are one per generic instance.** Sharing goes through a non-generic function.
- **Transients are orthogonal to marks and async.** Only the outermost call makes one; every call
  nested in it shares it, async calls included.
- **`transient` modifies `let`,** as `hold` does, at the top of a function's body.
- **Getters are methods annotated `@Getter`,** with no syntax of their own, read with `.` on every
  type, shared structs' handles included.
- **No compile-time getter cycle check.** Following closures through the heap would need a
  program-wide analysis the compiler doesn't have, and it would flag every computed graph as a
  cycle, since every computed's refresh sits in one non-generic field. Computed cycles are caught
  where their dependencies are known: at run time by the library, and in FormBuilder's generator.
