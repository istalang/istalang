---
description: the host boundary (spec §3.6, §9) — compiled JSON codecs, host externs and their futures, start entries, extern constants, the host API and the package's exports; read before changing externs, json, Stringable/Parsable, annotations, or how values reach a host
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-26
last_updated: 2026-10-26
tags: [boundary, json, externs, host, runtime, lowering]
---

# Host boundary

Every value that crosses to or from a host is JSON, converted by the declared type (spec §9). This
doc says where each part of that lives and why.

## Codecs are compiled code

A type's JSON form can run program code: a struct that is `Stringable` is written through its own
`toString` and read back through its `parse`, and map keys go through `toString` too. The runtime
can't call program code from inside a native (D-A removed the re-entrant call path), so the
conversion is compiled, per type, the way generics are instantiated:

- The `json` module (a language module, loaded with every program) declares `Json`, an enum holding
  any JSON, and two externs whose bodies the compiler writes per instantiation: `_encode<T>` and
  `_decodeAt<T>(json, path)` (`language/well-known.ts`, `codecFunctions`). `encode`, `decode`,
  `stringify` and `parse` are ordinary code over them, requiring `Encodable` or `Decodable`; the
  two themselves require only a form, since a disposable host type crosses to its host without
  being sendable.
- The checker decides each type's form once (`checker/rules/json-forms/`, memoized per type key; the
  form model is `form.ts`, which later phases read through `Checker.json`):
  field names after `@JsonName`, skipped and `@JsonBigInt` fields, whether a struct or enum is
  `Stringable` (and `Parsable`), and the helper calls each part needs, resolved with their witnesses
  in the type's own module, so a form belongs to the type alone. A type with no form is a
  diagnostic where it would cross: `Encodable` and `Decodable` are derived markers, like `Sendable`,
  for "has a form to write / to read", and generic code and generic externs carry them.
- Lowering writes each codec instance's body from the form (`lowering/boundary/encoder.ts`,
  `decoder.ts`): structs, enums and tuples field by field, everything else as calls to json-module
  helpers, a container's helper given the element's codec as a function value. A nested type is a
  call to its own codec, so a recursive type's codecs call themselves.
- What is left to natives is leaf work with no program code in it (`stdlib/json/natives.ts`,
  `definition/json-values.ts`): JSON text to `Json` and back (lossless-json, integers exact, nesting
  bounded by `maximumDepth`), a float's finiteness, sorting an object's entries.

## Externs a host implements

A host extern is called through a compiled wrapper (`lowering/boundary/host-externs.ts`), the entry
its instance is numbered by, so its native sees only JSON:

- The wrapper encodes each argument, calls the native entry, and reads the result
  (`boundary/inbound.ts`): a result that doesn't decode panics the instance (`_hostResult`).
- The native entry keeps the declared key (`purchase.chargeCard(string, int)`), so a host binds by
  the signature it was written against, and carries its `declaredType` (the result), which the
  runtime holds the host to across deploys (`runtime/boundary/extern-signatures.ts`).
- An extern returning `Future<T>` hands back a future the host names with a token of its own. The
  wrapper is async: it awaits the raw future and decodes, so it is an execution of its own, which
  `inspect` shows waiting at the extern's declaration. The host fills the future later
  (`Runtime.fill`), which runs the waiting wrapper in the same call, so JSON that doesn't decode
  (`_hostInput`, `_refuse`) fails the host's call and nothing commits.
- An extern returning a host handle, a `Shared<S>` whose struct has only function fields
  (`checker/host-externs.ts`, `hostHandleOf`), as the inbox module's `Revertible<T>` is,
  takes JSON naming the handle from its native. The wrapper captures it in a closure for each
  field, whose entry calls that field's own native, keyed `<extern key>.<field>`
  (`handleFieldKey`), with the JSON first and then its arguments, read back as any wrapper reads;
  the wrapper shares the struct through the json module's `_hostHandle`. The host thus learns that
  a revertible send was released when its `retract` is called, by the JSON it named the send with,
  which the closure keeps across commits.
- An extern constant is read through an entry that decodes the native's value; the runtime calls
  the native once per instance and pins the value in the snapshot (`pinned`).
- A host type a `dispose` makes disposable (an extern its host implements, or code passing the
  value to the host's externs) has values with an identity of their own: `_decodeHandle` keeps
  the host's JSON in a `resource` object (`definition/types.ts`, `isResourceType`), `_encodeHandle`
  gives that JSON back, and the type entry's disposal calls the `dispose` at release. It can't be
  declared sendable (5910) and isn't `Encodable` or `Decodable`, which imply Sendable, so it
  crosses only to its own host; an extern constant, one value for every read, can't hold one
  (5911).
- Host natives (`runtime/boundary/host-natives.ts`) take and give JavaScript JSON, what
  `JSON.parse` of the text gives but with every integer a `bigint`, so none loses digits; what a
  host gives back is read as `JSON.stringify` would write it, `undefined` as `null` or a field
  left out (definition/json-values.ts). The
  runtime's API takes them as `(arguments, call)`, where one returning a future gives back
  `call.pending(token)` and is filled later by `fill`: a durable host names the future so it can
  fill it from another process, and a name a future still waiting on the host has panics the
  instance, so a fill can't reach the wrong one; `ista run --host` names its futures by UUID. A
  host key the runtime's natives already have, such as `time.now()`, is refused at
  `createRuntime`, so no host replaces the clock. `ista run --host` loads a module of plain
  functions instead (`cli/host-module.ts`), each taking the arguments spread, and turns a returned
  promise into a pending future it fills between wakes; a promise can't outlive its process, which
  only a development host may assume.

## Starting instances

A startable function (top-level, not generic or extern, or a constant holding a sendable lambda;
by-value parameters that can be read, an outcome that can be written) gets a start entry, listed in
the Definition's `starts` under its key. A start entry is the function's own body compiled once
more with JSON at its edges (`lowering/boundary/starts.ts`, `FunctionLowering.lowerStart`): it
decodes each argument, a mismatch failing the host's start, and encodes whatever it returns, so the
instance is one execution of the function and its traces and waits are the function's own. `main`
is started through its own; what a host reads of an outcome is JSON by the declared result,
as JavaScript values (`outcome`) like everything else it exchanges, or as text (`outcomeText`),
which `ista run` prints (`runtime/boundary/outbound.ts`).

The host API (`runtime/host.ts`) starts by key with JSON arguments (`start`), fills a named future
(`fill`), inspects, and operates panicked instances: `retry` re-runs the failed segment from the
last commit at the time it first started, `terminate` ends it from its last commit: its root stops, so what
it held is disposed as any release disposes it, a disposed call's `disposing()` cleanup included,
and any execution only other executions hold stops after it (`scheduler/segment/`, `endInstance`);
a disposal that panics counts as done, so the rest still tell their hosts. A fill naming no future the instance waits
on, disposed or never there, changes nothing: the runtime keeps no record of disposed tokens,
which would grow without end. A panicked instance refuses fills until retried. A name with `/` is
the runtime's, for spawned instances.

## Packages

`istalang/runtime` (the host API) and `istalang/stdlib` (the std natives) are subpath exports, each a
tsdown entry. Their declarations come from TypeScript itself (`tsconfig.declarations.json`):
tsdown's declaration plugin needs TypeScript's JS API, which TypeScript 7 lacks, or isolated
declarations, which the definition layer's schemas aren't.

## Open with other slices

- A spawned instance's outcome is the value its function gave, not JSON: a host reads only what a
  start entry encoded.
