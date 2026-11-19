---
description: functions generic over their mark, transparent generics, the kind of what a type parameter computes; read before changing mark-generic code
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 9.2 Mark parameters

- **Mark parameters.** A function's head may name its mark (§9.1) instead of writing `live` or `ista`: a member parameter of `Mark`, as in `M fn each<T, M in Mark>(xs: Array<T>, f: Fn<(T,), Unit, M>)`; one of `Persistence` on an async head, whose future takes it, as in `K async fn twice<K in Persistence, T>(f: Fn<(), Future<T, K>, K>) -> T`; or, on a trait's requirement, an associated type bounded to one member of `Mark` (`type Mode in Persistence`, §8.2), `Self.Mode fn`. Its code is generic over its mark, handling that mark's data and calling functions of it, so one function serves code of every mark. A head naming anything else is a compile error. A call bounds its callee's mark by its caller's: a mark nothing fixes settles to the least the call's arguments, its expected type and that bound allow, so `time.delay(5s)` is an ista timer in ista code and a `K` one in a `K async fn`; a mark fixed above the bound is an error naming the call, as `retry` given a live function is in ista code.
- **Transparent generics.** Generic code handles its type parameters' values whatever they stand for: the code naming their type handles them, and is judged there (§9.1). So `Array<Socket>`'s functions work in live code, and `id(f)`, `f` a live future, is an error in ista code, which would hold it, and fine in live code. A type parameter's requirements and its `dispose` pass through the same way: unmarked generic code releasing a `T` that is a `Socket` is no error.
- **What a type parameter computes has its bounds' kind.** No caller names `T.Data`, so no caller judges it: an associated type of a type parameter is of the kinds its trait's bounds allow (§8.2), `DataKind<"simple">` where none is written, so simple; `DataKind<"live" | "simple">` live or simple. A use of a type `match` its type parameters don't decide yet is of its cases' kinds (§4.6).
