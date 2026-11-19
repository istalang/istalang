---
description: which types may leave an instance (Sendable) and which reach no disposable (Inert); read before changing sendability or inertness
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 7.4 Sendable and inert types

**Sendable types.** Only sendable values can leave an instance: in the function `spawn` starts a new one with (§17.1), or through extern declarations. Sendable types are the ones that satisfy the built-in `Sendable` trait (§8.4). A type is sendable when it is:

- a primitive or a literal type (§4.3);
- an extern struct that is a value, or a `sendable` handle (§17.2), whose type arguments are all sendable;
- a user struct or enum whose fields are all sendable, a tuple whose elements are, or a union whose members are. This is derived automatically, and a recursive type is sendable unless something in its cycle isn't;
- a type parameter constrained `is Sendable`;
- a sendable function type, `sendable fn(A) -> R` (§6.4). It refers to code, so it goes only to an instance of the same program, through `spawn`: an extern declaration, or `json`, whose types contain one is a compile error.

Handles other than `sendable` ones, such as futures, slots, `Shared` values, inboxes and weak references, and values of plain function types are never sendable, and neither is any value that contains one. They therefore never leave the instance that created them: what a spawned function captures and extern declarations can't contain them, which is a compile error.

**Inert types.** A type is inert when its values reach no disposable at any depth (§16): the types that satisfy the built-in `Inert` trait (§8.4), derived as `Sendable` is. Every sendable type is inert. So is a shared struct that declares no `dispose`, or an extern handle that isn't disposable, whose parts are all inert (`Shared<T>` when `T` is, and a `WeakRef`, which holds nothing); an inert function type, `inert fn(A) -> R` (§6.4); and a type parameter constrained `is Inert`, or by a trait implying it. Disposables, plain function types, `any` types not bounded by `Inert`, unconstrained type parameters and anything holding one of these aren't. A recursive type is inert unless something in its cycle isn't.
