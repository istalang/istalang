---
description: proposal 16 of docs/proposals, keyed members — `x.k`, where x's type has no member k, is `x["k"]`, read through an `index` whose key is a member parameter of String literals (`K in keyof S`), each key its own instantiation and result type; rules, what it takes, acceptance, spec edits and the decisions; read before designing or implementing it, or a library that mirrors a struct's fields as members (scopes, proxies, typed clients)
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [proposal, language, members, index, operators, keys, generics, forms]
---

# Proposal: keyed members

**Motivation.** A type that serves one member per field of another type has to declare each one
by hand. A function generic over a key already reads any field with the right type, `index`
included (§3.9):

```python
fn index<S is struct { [_] is FormNode }, K in keyof S>(self: GroupScope<S>, key: K) -> S[K].Scope:
    self._m[key].scope()
```

`index(d, "city")` is a `String?`, `index(d, "company")` a `GroupScope<Company>`, and
`d.index("countyr")` an error, all today. Only member syntax can't reach it.

- **FormBuilder's scopes** (`examples/FormBuilder/`): an expression reads `data.company.size`, and
  each read must go through the model so that it is tracked. So the generator mirrors every model
  struct with a struct of forwarding getters. The supplier form has 13 such structs with 51
  getters, all restating its model's shape:

  ```python
  struct SupplierSeen:
      m: SupplierModel

  fn get city(self: SupplierSeen) -> String?: self.m.city.seen()
  fn get company(self: SupplierSeen) -> SupplierCompanySeen: SupplierCompanySeen{m: self.m.company}
  # … one per field, and again for every group, row and case
  ```

- **Elsewhere:**
  - a typed client whose operations are members (`api.user(id)`);
  - event hooks named by event (`on.click(f)`);
  - a builder with one setter per field (`b.country("DE")`).

  Each is a declaration per name today, or a string-keyed call the compiler can't check.

## Keyed members

Member syntax reads through `index` when the name is no member. The forms engine then declares its
scope once, for every model:

```python
struct GroupScope<S is struct { [_] is FormNode }>:
    _m: S

fn index<S is struct { [_] is FormNode }, K in keyof S>(self: GroupScope<S>, key: K) -> S[K].Scope:
    self._m[key].scope()
```

`data.city` on a `GroupScope<SupplierModel>` is `index(data, "city")`, with `S` as `SupplierModel` and
`K` as `"city"`. A group's `Scope` is its `GroupScope`, so `data.company.size` reads through it twice,
each read tracked field by field.

**The rules:**
- **`x.k` is `x["k"]`:**
  - when `x`'s type has no field, getter or method `k` visible to the use;
  - and an `index` taking `x` as `self` takes a key whose type is a member parameter of String
    literal types: `keyof S`, or literals written out (`K in "click" | "hover"`).
  - The key is `k` as its literal type, which must be within that union.
- **Keyed indexes only.** An `index` taking any `String`, as `Map<String, V>`'s does, is no such
  `index`. So `m.size()` keeps its meaning, and `m.foo` stays an error.
- **Chosen as a method call** (§3.7): the receiver gives its type parameters exactly (§3.5), and
  the key fills `K`. So a chain, `data.company.size`, chooses each read once its receiver is known.
  - `x["k"]` written with the operator chooses alike. Today the operator widens the key to
    `String` first (B98).
- **Each key is its own instantiation,** as for any member parameter (§3.5). So each name has its
  own result type: `data.city` is a `String?`, `data.company` a `GroupScope<Company>`.
- **Calls and chains:**
  - `x.k(args)` calls the function the read gives, as for a getter or a field holding one (§3.1).
  - `x?.k` is `x?.["k"]` (§4).
- **One meaning per name.** A name served by both a member visible to the use and a keyed `index`
  is a compile error at the use, as a getter beside a field is (§3.1). Two keyed indexes taking one
  key resolve as overloads do (§3.7).
- **Reads only.** `x.k = v` stays an error; writing through `setIndex` is left for later.
- **String keys only.** Member syntax spells names, and `t.0` is a tuple's own (proposal 12).
- **Not a field.** A keyed read is never stored, no literal gives one, and it meets no trait's
  field requirement, since which names it serves is known only per instance.
- **Errors name the keys:** "'GroupScope<SupplierModel>' has no member 'citty'; its index takes keyof
  SupplierModel: categories, certifications, city, company, …".

## What it takes

- **Syntax:** none. The parser, formatter and VS Code grammar are unchanged.
- **Checker:**
  - B98: the `[]` operator chooses `index` as its method call does.
  - In the one unit that decides what a name on a receiver means (structural-fixes C), a name with
    no member asks the keyed indexes taking the receiver. The one-meaning check covers both.
  - A key outside the union reports the keys.
- **Lowering:** none of its own. A keyed read is the call `index(x, "k")`: flow building passes
  the key as its second argument (`rules/flow/build/member-values.ts`), where a getter read passes
  the receiver alone.
- **Language service:**
  - completion after `.` lists the union's keys beside the named members;
  - a keyed read denotes its `index` call, as a getter read denotes its getter: hover shows the
    instance and type, and go-to-definition reaches the `index`;
  - reaching and renaming the field the key names is left for later (F36).

**Spec edits:**
- §3.9: the `x.k` row of the operator table. `x[k]` chooses as a method call.
- §3.1: one meaning per name covers keyed reads, which are never stored.
- §3.7: what member syntax finds, keyed reads last.

## Its first user

FormBuilder (`docs/work/done/computed/design.md`):
- **The engine** declares `GroupScope<S>` and its keyed `index`.
- **FormNode** gains `type Scope`, what an expression's read of the node gives, and `fn scope`:
  - every group's is its `GroupScope`, a mounted form's included;
  - a wrapper's passes its node's through: `Hidden<N>`'s is `N.Scope?`, and `Local<N>`'s is
    `N.Scope`;
  - every other node's is its `Seen`. A list's or variant's is read whole, as today; a list's
    rows get their own scope inside their view.
- **Reads are tracked per field:** a computed reads `contact.card.phone` and reruns only when
  `phone` changes.
  - A scope is no value. It has no `==`, can't be passed as data or encoded, and a field loop or
    `keyof` over it sees its own `_m`.
  - GroupScope gets no whole-value read until an expression needs one.
- **The generated module** keeps the model types, the view and its expressions. Every scope struct
  and forwarding getter goes; only the context getters (`params`) stay.
- **A change to expressions:** today the generator reads a mounted form's group (`card`) and a
  hidden group (`address`) whole. Both become scoped. Neither form's expressions read them today.

With proposal 17, which builds models from their types, the generated module keeps the model types,
the view and its expressions.

## Acceptance

1. **B98:** `d["country"]` checks, as `index(d, "country")` does. A test fails before the fix and
   passes after it.
2. **Per-key types:** on a `GroupScope<SupplierModel>`, `d.city` is a `String?` and `d.company` a
   `GroupScope<…>`. A wrong expected type is reported.
3. **Chains:** `d.company.size` checks and reads that field's scope.
4. **Misses:** `d.citty` reports, listing the keys.
5. **Collisions:** a field, getter or method and a keyed `index` both serving a name is an error at
   the use.
6. **Plain indexes:** `m.size()` on a `Map<String, V>` is unchanged, and `m.foo` is still an error.
7. **Calls:** `x.k(args)` calls the function a keyed `index` returns.
8. **Editor:** completion after `d.` lists the keys. Hover shows the instance and type.
   Go-to-definition from `d.city` reaches the `index`.
9. **FormBuilder:**
   - no scope struct or forwarding getter is left in `order.gen.ista` or `supplier.gen.ista`;
   - `form-spec.test.ts` and both forms' tests pass;
   - the expressions that changed are listed in the phase's report.
10. **No syntax:** no parser, formatter or grammar file changes.

## Decisions (the human's, approved 2026-11-15)

- **Member syntax reads through a keyed `index`,** decided 2026-11-15, in place of key-named
  functions. It is this proposal's earlier draft, `fn get [K in keyof S]<S>(…)`.
- **A collision is an error at the use,** not a silent preference for either member.
- **Chosen as a method call,** the receiver first.

- **Reads only** for now; writes through `setIndex` come later.
- **String keys only.**
- **No field requirements met** by keyed reads.

**Rejected:**
- **Key-named functions** (the earlier draft): a getter or method whose name is a key type
  parameter.
  - It needs new head syntax.
  - It needs a function with no name, and a function's name is read in 55 files: binder, checker,
    lowering, runtime traces and editor.
  - It needs a type parameter read as a value.
  - `index` already expresses all of it.
- **A string-keyed member hook** (Scala's `Dynamic`, JavaScript's `Proxy`): the name arrives as an
  unchecked `String`, so a misspelled name fails only when it runs.
- **Generating the members** (today): the knowledge they repeat stays in every generated module.

This is Swift's `@dynamicMemberLookup`, with literal key types in place of key paths. A returned
function covers methods.
