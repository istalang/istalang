---
description: simple, live and ista data and code, the data rule, which calls a mark allows; read before changing marks or kinds
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 9.1 Marks and the data rule

**Marks and the data rule.** Data is simple, live or ista, and code is marked with the data it may handle. The mark is the head's, written, never implied:

| Head | Handles | Calls |
| --- | --- | --- |
| `fn f()`, unmarked | simple data | unmarked functions |
| `live fn f()`, `live async fn f()` | simple and live data | unmarked and live ones |
| `ista fn f()`, `ista async fn f()` | simple and ista data | unmarked and ista ones |
| `M fn f<M in Mark>()`, `K async fn f<K in Persistence>()` | simple data, and its mark's | unmarked ones, and its mark's |

- **Kinded data.** A live future and an `extern live struct` value are live, an ista future is ista, and so is a value whose release runs code of a kind (§16), since releasing it calls that code: a slot, whose `dispose` is the runtime's `ista` one, and so an inbox. A type's kinds are read from its declarations, a `dispose` that takes it counting by its mark whatever its constraints, never from what meets a trait, which asks a type's kinds (§8.4). A value holding kinded data at any depth is of its kind; a type declared holding both kinds is a compile error where it is declared, and so is any value of both kinds. A function value is simple data whatever its mark: holding one calls nothing. A value of a kind may become a value of an `any` type, whose type hides its kind: it does so where it is computed, in code of its kind, and no call or crossing takes it to code of the other kind (§8.3), so the kind it hides never meets the other.
- **The data rule.** Code handles only data its mark allows: its parameters and result, and every value its body and its defaults compute, locals and temporaries included, every name it binds, what its closures capture, and the type arguments of the calls it makes, whose callee handles their values as simple data (§9.2). A top-level constant is simple code. `fn f(s: Socket)` is a compile error: "'f' holds Socket, of kind live; declare it 'live fn'". One value per function is reported, the mark it asks for mending them all.
- **Calls follow from it.** Running a marked function makes data of its kind in its caller, so a callee's mark is at most its caller's, `"simple"` below the two kinds, which are apart: ista code calls nothing live, live code nothing ista, and unmarked code nothing marked. Implicit calls count: an operator's function, `iterate` and the cursor a loop calls, and the `dispose` a release runs, which the data rule judges through the released value's kind. A generic callee calls its constraints' witnesses for its caller, so a generic function named as a value with its type arguments, a function that makes a call when called, is of the least mark allowing its callee, those witnesses and its type arguments' values; a deferred call's function is a lambda (§6.5). The error names the call: "'y' calls live 'x'; declare it 'live fn'".
- **Unmarked is simple.** An unmarked function is simple whatever its signature or body, so `fn x(): _ = time.delay(1s)` is an error, the timer being of a kind. An unmarked `async fn`, whose future would have no kind, is a compile error, and so is an unmarked `async fn` type (§6.4). A struct's defaults and a variant's constructor are of the kind their fields' written types hold (§5.2): a field whose default makes data of a kind writes its type, and so does one whose default's type holds values whose kind the type arguments decide: a type parameter's, unless its bounds allow simple data alone, or a type computed from them. Only a lambda infers its mark (§6.4).
- **Generic code is transparent** to its type parameters' values (§9.2), and a function generic over its mark is compiled once per mark it is used at.
