---
description: the deferred-call form g f(args): what runs now, what g takes, what is captured; read before changing deferred calls, spawn or defer syntax
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 6.5 Deferred calls

**Deferred calls.** `g f(args)` gives `g` a function that makes the call `f(args)` later, with everything written computed now:

```python statements
retry fetchUser(id)                    # retry({ const x = id; fn(): fetchUser(x) })
retry(times: 5) fetchUser(id)          # g's own arguments in parentheses
pool.submit encode(file)               # a method takes it, its receiver as self
retry load(id).process()               # load(id) runs now, process() later
spawn purchase(req)                    # req now, purchase(req) in a new instance (§17.1)
_ = defer log(x)                       # x now, log(x) as the block ends (§16)
```

- **Shape.** A name, or a path of names joined by `.`, maybe called with arguments of its own, then on its line a call. Parsing reads it from the text alone, so it never depends on what a name means; a range's `by` stays the range's.
- **What runs now:** the callee, with its receiver and any calls before the last one, and every argument written, left to right. Only the outermost call is deferred. A default the call leaves out is computed when the call is made, later (§6.1). A value computed now is typed by what it is, as a constant's value is, not by the parameter it fills: an argument whose type only that parameter decides, such as a generic call's result, needs it written. An argument that computes nothing (a literal, a lambda, a name of a function or a variant, `none`, `[]`, or a literal of such parts) is the same value made now or later, so it is made with the call and typed by it.
- **What `g` takes:** a parameter of a function type taking nothing, `fn() -> X`: the first such parameter its other arguments, by position or by name, leave unfilled, so `retry(times: 5) fetchUser(id)` gives `retry` its `f`. A method counts, its receiver as `self`. Any other `g` is a compile error: it doesn't take a call to run later. The function gives what the call gives, and fits as any function value does: an async callee's future goes as it is where `Fn<(), Future<X, K>, K>` is taken, and a value where a future is taken goes into one already resolved.
- **What's captured:** the values computed now, as copies. The function is the lambda `fn(): f(args)` capturing them: its mark is a lambda's, the one its parameter gives, else the code's around it where it calls or handles anything of a kind, and it is sendable when they all are, so a `sendable fn` parameter needs each of them sendable. No reference can be captured, so a `&` argument, or a receiver its method takes by `&self`, is a compile error. A call through `?.` is deferred as any is, its receiver read now: the function gives `none` where that receiver is `none`.
- **Precedence** is prefix `await`'s (§10.3): `await retry fetchUser(id)` is `await (retry fetchUser(id))`, the call takes its postfix operators along, and `(g f()).x` needs its parentheses.
- **Nesting** reads from the right: `a b c(x)` is `a(fn(): b(fn(): c(x)))`, with `x` computed once, now.
- **The bracket form passes a value:** `retry(makeAttempt(x))` calls `makeAttempt` now and passes the function it gives.
- **A missing comma.** `[a b(c)]` reads as a deferred call. Where `a` is a value and no function, the error points at the comma likely missing after it.
- **No call needs a keyword.** `spawn` and `defer` are functions called this way (§16, §17.1), as is any function taking a call to run later.
