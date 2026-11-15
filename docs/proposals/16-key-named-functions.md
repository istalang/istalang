---
description: proposal 16 of docs/proposals, key-named functions — a getter or method whose name is a key type parameter, `fn get [K in keyof S]<S is struct>(self: Seen<S>)`, found by member syntax for every name its keys hold, the name filling `K`; the key binder (a type and its one value), rules, what it takes, spec edits and the decisions; read before designing or implementing it, or a library that mirrors a struct's fields as members (scopes, proxies, builders)
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [proposal, language, functions, getters, methods, keys, generics, forms]
---

# Proposal: key-named functions

**Motivation.** A type that serves one member per field of another type has to declare each one
by hand. Functions generic over a key already exist, `fn apply<S is struct, K in keyof S>(…)` with
`s[k]` reading the field `k` names (§3.1). What's missing is the call site: a member name can't
pick the key.

- **FormBuilder's scopes** (`examples/FormBuilder/`): an expression reads `data.company.size`, and
  each read must go through the model so that it is tracked. So the generator mirrors every model
  struct with a struct of forwarding getters. The supplier form has 13 such structs with 53
  getters, all restating its model's shape:

  ```python
  struct OrderSeen:
      m: OrderModel

  fn get country(self: OrderSeen) -> String?: self.m.country.seen()
  fn get city(self: OrderSeen) -> String?: self.m.city.seen()
  # … one per field, and again for every group, row and case
  ```

- **Elsewhere:** a typed client whose methods are a service's operations (`api.user(id)`), event
  hooks named by event (`on.click(f)`), a builder with one setter per field (`b.country("DE")`).
  Each is a declaration per name today, or a string-keyed call the compiler can't check.

## Key-named functions

A getter or method may take its name from a key type parameter. The forms engine then declares
its scope once, for every model:

```python
struct Seen<S is struct { [_] is FormNode }>:
    _m: S

fn get [K in keyof S]<S is struct { [_] is FormNode }>(self: Seen<S>) -> S[K].Scope:
    self._m[K].scope()
```

`data.country` on a `Seen<OrderModel>` is that getter, with `S` as `OrderModel` and `K` as
`"country"`. A group's `Scope` is `Seen` again, so `data.company.size` reads through it twice.

**The rules:**
- **The key binder.** `[K in U]` stands where the name would, after `fn` or `fn get`, before the
  type parameters. It declares the type parameter `K`, bounded by `U`, which must be a union of
  String literal types: `keyof S` of a type parameter declared after it, or literals written out
  (`[E in "click" | "hover"]`). Each instance has one key, so in the body `K` is also that key's
  value, a `String` of type `K`, as a field loop's `key` is (§4): `self._m[K]` reads the field it
  names.
- **Found by member syntax alone.** `x.name` finds a key-named getter, and `x.name(args)` a
  key-named method, among the functions whose `self` takes the receiver, as other methods are
  found (§3.7). Inference reads the receiver through `self` as it reads any argument, and the
  member's name fills `K` as its literal type, which must be within `U`. A key-named function has
  no name of its own, so no plain call `f(x)` reaches it.
- **One meaning per name.** A name served by both a declared member visible to the use (a field,
  getter or method) and a key-named function is a compile error at the use, as a getter beside a
  field is (§3.1). `_`-private members are never visible outside their module, so an engine's own
  fields don't collide with the names it serves. Two key-named functions serving one use resolve
  as overloads do.
- **Like any function of its kind.** A key-named getter takes `self` alone and isn't async; a
  method may take anything. Marks, generics, constraints and instances are as for any generic
  function: each key used makes its own instance.
- **Not a field.** As with getters, a key-named getter is never stored and no literal gives one.
  It meets no trait's field requirement either, since which names it serves is known only per
  instance.
- **Errors name the keys:** "'Seen<OrderModel>' has no member 'countyr'; its key-named getter
  serves keyof OrderModel: city, country, items, note, payment".

## What it takes

- **Syntax:** a function head's name position takes a key binder, `[K in U]`, after `fn` or
  `fn get`. The formatter prints it as written, and the VS Code grammar knows it.
- **Declarations:** key-named functions are kept per module beside named ones, found by the type
  of `self` instead of by name.
- **Checker:**
  - Member access asks named members first, then the key-named functions taking the receiver.
  - Inference fills `K` from the name.
  - In the body, `K` reads as a value.
  - The one-meaning check covers both kinds of member.
- **Lowering:** none beyond `K`'s value, a constant of its instance. Instances are spelled with
  their key, as with any type argument.
- **Language service:**
  - completion after `.` lists `U`'s keys beside the named members;
  - hover shows the instance;
  - go-to-definition from `data.country` reaches the key-named declaration;
  - rename skips the key, which is the other type's field name.

**Spec edits:**
- §2: the key binder in function heads.
- §3.1: getters, key-named ones among them, and one meaning per name.
- §3.5: the key binder as a type parameter, `K` as a value.
- §3.7: methods found by member syntax, key-named ones among them.

## Its first user

FormBuilder (`docs/work/computed/design.md`): its engine declares `Seen<S>` and one key-named getter
in place of every generated scope struct and getter. Each read stays tracked field by field, as a
generated getter's is. With proposal 17, which builds models from their types, the generated module
keeps the model types, the view and its expressions.

## Decisions (proposed, for the human)

- **Syntax `fn get [K in keyof S]<S is struct>(…)`:** the human's choice. The binder stands where
  the name does, and the type parameters follow.
- **`K` is a type and its value** in the body, so no extra parameter carries the key.
- **Member syntax only:** a key-named function has no name for a plain call.
- **A collision is an error at the use**, not a silent preference for either member.
- **No field requirements met** by key-named getters, for now.

**Rejected:**
- **A string-keyed member hook** (Scala's `Dynamic`, JavaScript's `Proxy`): the name arrives as
  an unchecked `String`, so a misspelled name fails only when it runs.
- **Key paths through subscripts** (Swift's `@dynamicMemberLookup`): typed, but only for reads
  through one subscript, not methods. It also needs key paths as values, a feature of their own.
- **Generating the members** (today): the knowledge they repeat stays in every generated module.
