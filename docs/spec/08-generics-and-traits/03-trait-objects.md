---
description: any types: conversion, variance, calls, object safety, equality, matching, run-time types; read before changing any types
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 8.3 Trait objects

**Trait objects.** `any A & B` is the type of a value of any type meeting each of its traits; `any T?` is `(any T)?`. It is how values of different types share a collection, a field or a parameter:

```python fragment
trait Notifier:
    fn send(self: Self, text: String)

const notifiers: Array<any Notifier> = [Email{to: "cfo"}, Sms{number: "555"}]
for notifier in notifiers:
    notifier.send("approved")
```

- **Conversion.** A value converts into an `any` type wherever one is expected and its type meets every trait, as a value converts into a union (§4.2); an `any` type converts into another whose traits are among its own. The traits are a set: their order doesn't matter, and naming one twice is an error.
- **Variance.** A trait's type parameter varies as its requirements use it, as an interface's does in C#: covariant when it occurs only in what they give (their results, its required fields, which an `any` value only gives), contravariant when only in what they take, invariant otherwise (§8.1). A value inside an `any` type keeps its own type, so it is never rebuilt at another argument; instead its type may meet another instantiation of the trait, one that stands for the one the `any` type names: a type meeting `Source<Int>` converts into an `any Source<Int?>`, and an `any Source<Int>` is an `any Source<Int?>`, where `trait Source<T>` only gives its `T`. Of several instantiations its type meets that stand for it, the closest is taken, the one each other stands for; several with none closer are an error where a value converts. A value an `any` type took from another may still reach such an `any` type unseen; a call through it then runs the functions of the first such instantiation, as declared, as C# picks among the interfaces a class implements. A call through it runs the functions of the instantiation the value meets, what they take converted from what the call is given and what they give into what the call gives, and a field it requires is read converted alike. A type meets a trait only with its own functions: an `Array<Int>` never meets one through a function declared for `Array<Int?>`, and `T is Source<Int?>` takes exactly that instantiation. A union's `any` member takes another member whole (§4.2) only where the member meets its traits as they are written: a member meeting one only through another instantiation stays beside it. A type test still sees variance wherever the `any` type stands: against an `any Source<Int?>`, alone or a union's member, `case Counter` finds a `Counter` that went in as a `Source<Int>` (§11.3).
- **Calls.** A function a trait requires is called on an `any` value like any other, `notifier.send(text)`, and runs the one the value's own type meets the trait with. An `any` type meets its own traits, so its values pass where `T is Notifier` is expected, and `String(x)` takes an `any Stringable`. A field a trait requires is read the same way and can't be written through the `any` value; a method taking `&self` changes the value inside it.
- **Object safety.** A trait can follow `any` only when each function it requires takes `Self` first, as its receiver, by value or `&`, and nowhere else, its mark included (`Self.Mode fn`), and none is static; and no field it requires is built from `Self`. An associated type of `Self`, `Self.Data`, counts as `Self`. So `any Stringable` and `any Iterable<Int>` are types, but `any Comparable`, whose `compare` takes a second `Self`, and `any Default`, whose `default` is static, are errors.
- **Values.** `==` compares the values' types, then the values, so an `any` value can be a map key. An `any` type is sendable only when one of its traits is `Sendable`, or `Encodable` or `Decodable`, which imply it, as in `any Notifier & Sendable`, and a value converted into one must be sendable. Likewise, an `any` type is inert only when one of its traits is `Inert` or implies it, and a value converted into one must be inert. JSON derives no form for an `any` type and decodes nothing into one; `any Encodable` writes the JSON of the value inside.
- **Matching.** A pattern naming a type matches an `any` value holding one, primitives included: a bare type name (`case Int as n`, `case Email as e`, §11.3), a struct pattern (`case Email{to}`), or a variant qualified by its enum (`case Decision.Approved(by)`). An alias names the type it stands for. The rest of the pattern then matches the value inside, and `as` binds that value with its own type. A pattern gives no type arguments, so it can't name a generic type, and it can't name a type that doesn't meet the traits. The types an `any` type holds are an open set, so a `match` on one ends with `case _`.
- **Running.** A value keeps its own type inside an `any` value, in snapshots and messages too, so the runtime knows the type at every call through a trait. Which types an `any` type holds is decided over the whole program; an `any` value has no JSON form, so it reaches only instances of the same program, whose code is fixed for their whole lifetime (§14).
