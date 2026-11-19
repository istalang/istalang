---
description: let and const, block scope, hold and block labels, transient variables, context constants; read before changing variables or their lifetimes
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 7.1 Variables

```python statements
const limit: Int = 50_000          # immutable
let count = 0                      # mutable; inferred: Int
count = count + 1

const roles = ["legal", "finance"]
roles.push("cfo")                  # compile error: roles is const
```

`let` declares a mutable variable and `const` an immutable one. A `const`, a `let` or an assignment may end its line at `=`, with an indented value on the lines below (§3.2), built as the variable's type. Without a written type, a variable has its initializer's type, which a `let` widens, since a later assignment may give it any value of the wider type: a literal type to its base (§4.3), and a sendable function type to the plain one (§6.4). A `const` is deeply immutable: it can't be reassigned, its fields and elements can't be changed, and you can't take `&` of it, so mutating methods like `push` are rejected. Immutability stops at handles: a `const` slot or inbox can still be used, and the fields of a `const` shared struct can still change through `->`, because that changes the cell behind the handle, not the handle itself. The compiler warns about a `let` that is never reassigned or mutated: assigning to one of its fields or elements, passing it by `&`, and calling a method that takes `&self` on it all count as mutating it. In a `let` declaring several names, each name never changed is warned about, to be declared as a `const` of its own.

Variables are block scoped: a variable is visible only inside the block that declares it and in blocks nested within it. A variable declared inside an `if` body does not exist after the `if`. A loop variable (`for x in xs`) and every variable declared in a loop body are fresh on each iteration, so closures created in different iterations never share them. Unlike Python, assigning to an undeclared name is a compile error. Declaring a name twice in one block is a compile error too, also for two local functions, which therefore can't be overloaded; a nested block may shadow a name from an enclosing one. Types and values share one namespace per scope.

**Lifetimes follow blocks too.** When a block ends, whether it finishes or is left through `return`, `break`, `continue` or disposal, it releases everything its variables hold (§16). A loop body is a block, so each iteration releases its own holdings. `hold let` and `hold const` declare a variable whose *name* is still block scoped but whose holdings last longer, which is how a loop keeps what it starts: until the enclosing function ends, or, written `hold(name)`, until the loop or block labelled `name` (§11.1) ends, however it ends; `continue` of that loop keeps them. `hold(f)` naming the enclosing function is plain `hold`. What the variable holds when its block ends is kept, while a value it held before and lost to an assignment was released then, as any overwritten value is. The common unnamed case has a short form: `hold _ = expr` means `hold const _ = expr`.

```python statements
for role in roles:
    hold _ = reviewQueue(role).sendRevertible(request) # revertible until the function returns
```

A block takes a label only so that a `hold` can name it: the label ends its line, and the block is indented below it. It is a statement of type `Unit`, and `break` and `continue` never name it: a loop takes its label on the loop's line, `outer: for x in xs:` (§11.1).

```python statements
batch:
    for job in jobs:
        hold(batch) _ = start(job)                      # runs until the batch ends
    await allDone()
```

**Transient variables.** `transient let` declares a variable the outermost call of its function makes and every call nested in it shares, directly or through other functions: a memo table, a depth counter, the reader a nested read reports to, kept neither global nor threaded through parameters.

```python
fn paths(n: Int) -> Int:            # ways up n stairs, one or two at a time
    transient let memo: Map<Int, Int> = [:]
    if n <= 1: return 1
    if memo.has(n): return memo[n]
    const total = paths(n - 1) + paths(n - 2)
    memo[n] = total
    total
```

- **One value per outermost call.** The outermost active call of the function makes it from its initializer, every call nested in it shares it, and the next outermost call makes a new one. An async call nested in it is nested too, also once the outermost call has returned; a spawned instance or a delegated job runs in another instance, so it starts afresh. A generic function's instances are functions of their own (§8.1), each with its own; code sharing one across instances routes through a non-generic function.
- **Where.** It stands at the top of a function's body, before its other statements, in any function: unmarked or marked, async or not, a lambda or a local `fn` included. It declares one name.
- **Its initializer** runs at the outermost call alone, so it sees no variable of its function, a parameter, a local or a capture: a name one of them would hide means what the module gives it, and one only they give is a compile error. It may name the function's type parameters. Its type may be left out, as a `let`'s may.
- **Written like a `let`:** assigned, changed, passed by `&` and captured by closures, which share its cell (§6.4). One its function never changes isn't warned about, since it still shares the outermost call's value.
- **Lifetime.** The outermost call holds it, the calls nested in it share its cell, and it is released when the last of them ends (§16).

**Context constants.** A top-level `ista const` holds one value per context (§17.1), of any type: a slot, an inbox, a `Shared<T>`. Its value is made the first time code in that context reads it, inside the reading segment, so a segment that is discarded made none, and is kept in the context's memory from then on. It is named as every declaration is, by its module and name, with one type, its written one or its initializer's. It is immutable as every `const` is, up to its handles. Its initializer runs as `ista` code that can't await, and reading one is an `ista` call (§9.1): a function that reads one is `ista`, so no live code reaches one. An instance that finishes or ends lets go of its context constants last, once everything else it held is disposed, the last made first (§16), so a disposal still reads them, but not one let go of before it.

```python
import Inbox from 'inbox'
struct Verdict { role: String, ok: Bool }
ista const verdicts = Inbox.create<Verdict>()
ista fn approve(v: Verdict): verdicts.send(v)          # every call in one context sends to one inbox
```
