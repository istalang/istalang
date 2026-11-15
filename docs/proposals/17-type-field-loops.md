---
description: proposal 17 of docs/proposals, field loops over a type — `for K in keyof S` in loops and in array and struct comprehensions, running once per field of a type with no value to read, `K` a key binder (proposal 16), and static functions called through a field's type, `S[K].make(…)`; so generic code builds a struct from its type alone; rules, what it takes, spec edits and the decisions; read before designing or implementing it, or a library that constructs values from a struct type (factories, defaults, schemas)
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [proposal, language, field-loops, comprehensions, keys, generics, statics, forms]
---

# Proposal: field loops over a type

**Motivation.** Field loops and struct comprehensions run over a value's fields (§4), so generic
code can transform a struct it is given. It can't build one from nothing, since there is no value
to loop over: the fields of `S` are known, but not reachable without an `S`.

- **FormBuilder's models** (`examples/FormBuilder/`): every form's generated factory restates its
  model type, field by field. The supplier form makes 47 such calls:

  ```python
  fn orderModel(graph: Graph) -> Group<OrderModel>: Group{
    fields: OrderModel{
      country: Field.make<String>(graph)
      city: Hidden.make(graph, Field.make<String>(graph))
      items: List.make(graph, fn(x): Group{fields: struct{sku: Field.make<String>(graph, x?.sku), …}})
      …
    }
  }
  ```

- **Elsewhere:** a default value or blank record for any struct; a decoder written in Istalang
  for any struct, each field from its own codec; a schema listing a type's fields and their types
  for a form or a table, with no example value to read them from.

## Field loops over a type

A field loop may run over a type's keys instead of a value's fields. The forms engine then builds
any model from its type:

```python
trait FormNode:
    type Seen
    fn Self.make(graph: Graph, data: Self.Seen?) -> Self

fn Group.make<S is struct { [_] is FormNode }>(graph: Graph, data: Group<S>.Seen?) -> Group<S>:
    Group{fields: S{for K in keyof S: [K]: S[K].make(graph, data?.[K])}}
```

`Group<OrderModel>.make(graph, none)` builds the whole model. Each node's `make` builds what it
holds: a list its rows, a variant its cases, a hidden node the node it hides.

**The rules:**
- **Three forms,** as over a value: a loop `for K in keyof S:`, an array comprehension
  `[for K in keyof S: expr]`, and a struct comprehension's last entry,
  `struct{for K in keyof S: [K]: expr}`. Fields are taken in name order (§3.1).
- **`K` is a key binder,** as in proposal 16. In each pass it is the field's name as a String
  literal type, and in expressions that key's value, so `data?.[K]` reads the field it names. The
  header takes `keyof` alone, which no expression can begin with, so it never reads as a loop over
  an `Iterable`.
- **`S[K]` is the field's type,** and the static functions its constraint requires are called
  through it, as through a type parameter (§3.10): `S[K].make(graph, …)`. A type parameter indexed
  by a key, written before `.`, names a type, never an index into a value.
- **Checking** follows field loops over a value. Over a struct type, the body is checked once per
  field. Over a type parameter with a struct constraint, it is checked once per field the
  constraint names, and once for the others, where `S[K]` is opaque but meets the constraint's
  `[_]` entry. So `S is struct { [_] is FormNode }` lets `S[K].make` check for every field.
- **A loop like any other:** `break`, `continue`, labels and `await` work as in a field loop over
  a value, and so does a struct comprehension's rule that named fields come first.

## What it takes

- **Syntax:** a field loop's header and the comprehensions take `for K in keyof T`, and a
  static call takes an indexed type before `.`. The formatter prints both.
- **Checker:**
  - field loops get a second source of passes: a type's keys, with no value;
  - the binder is shared with proposal 16;
  - static calls go through `S[K]`, resolved against the constraint's `[_]` entry.
- **Lowering:** unrolled per instance, as field loops over a value are. `K` is a constant in each
  pass.
- **Language service:** hovering `K` and `S[K]` shows the pass's key and field type, as for a
  field loop over a value.

**Spec edits:**
- §4: field loops and both comprehensions over a type's keys.
- §3.10: static functions called through an indexed type.
- §3.1: `keyof` in a loop header.

## Its first user

FormBuilder (`docs/work/computed/design.md`): each model node's static `make` (`Field`, `Hidden`,
`List`, `Variant`, `Group`) builds it from its type and optional data. Every generated factory and
row maker goes, and so does `List.make`'s row closure, since a list's rows are `R.make`. With
proposal 16, the generated module keeps the model types, the view and its expressions.

## Decisions (proposed, for the human)

- **`for K in keyof S`,** reusing proposal 16's key binder, so `K` is a type and its value here
  too.
- **`keyof` only in the header,** not any union of literals, so the parser never confuses it
  with a loop over an `Iterable`.
- **Static calls through `S[K]`,** not only through plain type parameters.

**Rejected:**
- **Looping over a default value:** building the blank value needs this very feature.
- **Type-level functions (dependent factories)** that compute a value from a type: a feature far
  larger than this need.
- **Generating factories** (today): the model's shape stays restated in every generated module.
