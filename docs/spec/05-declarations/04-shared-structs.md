---
description: shared structs: handles built with new, read through -> and *, identity, disposal, Shared<T>; read before changing shared structs
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 5.4 Shared structs

A `shared struct` is a struct whose values are handles to a cell of the instance's own memory, holding its fields. A module declares one when it needs values with an identity, such as a queue or a resource, where a struct, copied whenever it is passed, has none.

```python
shared struct Lease:
    name: String
    renewals: Int = 0

fn renew(self: Lease):
    self->renewals += 1        # every copy of the handle sees it
```

- **Built with `new`.** `new Lease{name: "db"}` makes a new cell holding the fields, from a literal like any struct's (§5.2): defaults, shorthand and a leading spread, which takes the value behind another (`new Lease{...*other}`). Only a shared struct is built with `new`, and only with `new`; either way round, the other is a compile error.
- **Read through, never with `.`.** `x->field` reads or writes a field, and `*x` the whole value, the shape of the fields (§5.2, §10.2), which any value of that shape writes or spreads into `new Lease{…}`. The fields are that value's, not the handle's, so `x.field` is a compile error, a struct pattern doesn't take a shared struct apart, and a shared struct meets a trait's field requirement only through a getter (§8.2). Methods are called with `.`, as on any type: `lease.renew()`, and getters are read so (§5.2).
- **Identity.** Copying a shared struct copies the handle, not the cell, and `==` compares handles by identity (§7.2). A shared struct is never sendable, so it stays in its instance, and has no JSON form (§17.4). It is invariant in every type parameter (§8.1): a `Shared<Int>` is no `Shared<Int?>`, since its fields are read and written through every copy. Its fields may hold the shared struct itself, since what they hold is a handle: `shared struct Node { next: Node? }`.
- **Its own module.** A shared struct is a nominal type of the module declaring it, so argument-dependent lookup finds that module's functions for it (§13.1), and a diagnostic names it as declared.
- **Disposal.** A shared struct has an identity, so a `dispose` declared beside it makes it disposable (§16), which is how a module makes a resource of its own.
- **`Shared`.** The prelude's `Shared<T>` is `shared struct Shared<T> { value: T }`, a shared struct of any one value: `new Shared{value: v}`, read and written as `x->value`. It is the prelude's, so only the prelude could make it disposable.
