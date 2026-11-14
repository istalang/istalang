---
description: proposal 13 of docs/proposals, two language additions — `transient` variables, one value per execution shared by a function's nested calls, and getters, `fn get name(self: T) -> R`, read as fields, with a compile-time check that no getter reaches itself; their rules, lifetimes, lowering and spec edits; read before designing or implementing either, or code that needs recursion-scoped state or values computed from fields
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

## Transient variables

```python
fn paths(n: Int) -> Int:            # ways up n stairs, one or two at a time
    transient memo: Map<Int, Int> = [:]
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
- **One value per execution.** The outermost active call of the function makes it from its
  initializer. Every call nested inside it, directly or through other functions, sees the same
  variable, and it ends when that outermost call returns.
  - A `live async` call starts an execution of its own (§3.3), so its calls start fresh.
- **One per generic instance.** `f<Int>` and `f<String>` are separate functions (§3.5), each with
  its own. Code that must share one across instances routes through a non-generic function:

  ```python
  fn nested(callback: fn(Int) -> Unit):   # not generic, so every caller shares one depth
      transient depth = 0
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
- **It must have an initializer.** The initializer runs only at the outermost call, so it can't read
  the function's parameters or locals. Its type may be left out, as a `let`'s may.
- **Lifetimes:** the outermost call's frame holds the value, and nested frames share its cell. It is
  released when that frame ends, like any variable of it (§7). In ista code it persists with that
  frame.

## Getters

```python
struct Person:
    first: String
    last: String

fn get full(self: Person) -> String: `${self.first} ${self.last}`

const ada = Person{first: "Ada", last: "Lovelace"}
ada.full                    # "Ada Lovelace", computed on every read
```

**The rules:**
- **Declared like a method,** with `get` before its name. It takes exactly one parameter, `self`,
  by value. It is not async, and it may be generic.
- **Read with `.`, as fields are.** On a shared struct it is read with `->`, as everything behind a
  handle is: `x->name` is `(*x).name`, whether `name` is a field or a getter.
- **One meaning per name:** on a type, a name is a field, a getter or a method, never two.
- **Never stored:** a literal never sets a getter, and nothing assigns one. `==`, hashing, the JSON
  codecs, struct patterns and `keyof` see the stored fields only, so `ada == Person{first: "Ada",
  last: "Lovelace"}` holds.
- **Found like methods,** by the type of `self`, so a module may declare getters for types it
  imports.

### No getter reaches itself

A getter that can reach itself is a compile error, naming the path:

```python
struct Pair:
    n: Int

fn get a(self: Pair) -> Int: if self.n > 0: self.b else: 0
fn get b(self: Pair) -> Int: self.a + 1
# error: getter 'a' can reach itself: Pair.a → Pair.b → Pair.a
```

- **What it follows:** calls, trait calls resolved per instance (witness closing), and function
  values. Closures, and the handles that hold them, are told apart by where they are made, so the
  check follows a closure stored in a struct into the code it was made from.
- **What it doesn't follow:** code it can't see into, such as a call through an `any` type.
- **It is conservative:** it judges code, not values, so a branch never taken still counts. A
  getter reaching the same getter on another value of its type counts too.

## What it takes

- **`transient`:**
  - a contextual keyword before a variable declaration, like `hold`;
  - one IR instruction, `transient dst, name`, which finds this execution's value or makes it, as
    `contextConstant` does for context constants;
  - a per-execution table in the runtime, which a restore rebuilds from the frames.
- **Getters:** parsing `fn get`, resolving a member read to a field or a getter, and lowering the
  read to a plain call, so the IR doesn't change.
- **The check:** a checker rule on the flow IR, after witness closing, with closures and handles
  told apart by where they are made.

**Spec edits:**
- §3.1: getters replace "No getters or setters".
- §3.4: `transient` variables.
- §3.9 and §3.18: `->` reads behind the handle and then resolves the name as `.` does, so it may call
  a getter.
- §7: a transient value is held by the outermost call's frame.
- A new rule for the getter check.

## Decisions

- **Transient values are one per generic instance.** Sharing goes through a non-generic function.
- **Getters are read like fields:** with `.`, and with `->` on shared structs.
- **A getter that can reach itself is a compile error** wherever its code is visible.
