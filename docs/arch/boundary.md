---
description: the host boundary (spec §3.6, §9) — JSON codecs as traits and derived codecs, host externs and their futures, start entries, extern constants, the host API and the package's exports; read before changing externs, json, Stringable/Parsable, annotations, or how values reach a host
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-26
last_updated: 2026-11-04
tags: [boundary, json, externs, host, runtime, lowering]
---

# Host boundary

Every value that crosses to or from a host is JSON, converted by the declared type (spec §9). This
doc says where each part of that lives and why.

## Codecs are traits

A type crosses through its codecs, `toJson` and `fromJson`: what `Encodable` and `Decodable`
require, declared in the `json` module (a language module, loaded with every program) beside
`Json`, the recursive union holding any JSON (`None | Bool | Int | Float | String | Array<Json> |
Map<String, Json>`, spec §3.17), whose values are the language's own and whose codecs are the
identity. Codecs are program code, found as every trait's witnesses are,
so the runtime never calls program code from inside a native (D-A removed the re-entrant call
path):

- Declared codecs are ordinary functions. The `json` module declares them for every primitive,
  `Json`, `Array`, `T?` and `Map`, the containers' generic over their elements' codecs; a module
  declares them beside its own types (the `time` module's `Time` and `Duration`, through
  `encodeText` and `decodeText`). A trait's witness may be declared in the trait's own module
  (`checker/resolution/choosing/candidates.ts`), which is how the `json` module's codecs are found from
  every module without an import. `encode`, `decode`, `stringify` and `parse` are generic code
  over the traits.
- A struct, an enum, a tuple, a host type, a literal type or a union of literals
  declaring neither codec, beside it or in the `json` module, has both derived. A union crosses
  only so or as `T | None`, through the `json` module's codecs of `T?`: any other union's member
  would need a tag JSON doesn't carry, so it has neither (spec §9). The checker decides its derived form once (`checker/rules/boundary/json-forms.ts`,
  memoized per type key; the model is `checker/surface/json-form.ts`, which later phases read through
  `Checker.json`): field names after `@JsonName`, `@JsonBigInt` fields, what a `@JsonSkip` field
  reads back as (its type's `Default` witness). Its parts cross through their own codecs, and
  witnesses are coherent (spec §3.10): found beside the types they take or the trait, never where
  they are asked for, so a derived codec belongs to its type alone. Conformance takes a derived
  codec when no declared one is found, as for every trait the compiler derives
  (`checker/resolution/conformance/derived-traits.ts`): a call to the `json` module's
  `_toJson<T>` or `_fromJson<T>`, externs whose bodies lowering writes per type
  (`language/well-known/index.ts`, `derivedCodecs`). A recursive type counts as meeting the trait while
  its own parts are decided.
- `Encodable` and `Decodable` imply Sendable, except where values cross to the host
  (`checker/use-site.ts`, `toHost`): an extern's parameters and results, an extern constant,
  `main`'s outcome, a start entry. There only codecs count, so a disposable host type, which isn't
  sendable, crosses to its own host alone or inside other values.
- Lowering writes each derived codec's body from its form, which carries the type it takes apart
  and builds (`lowering/boundary/encoder.ts`, `decoder.ts`, one per direction in `codecs.ts`):
  structs, enums and tuples part by part, each part through its own type's codec, a host type
  through `_encodeHandle` and `_decodeHandle`, and a literal type or union of literals through its
  base's codec, read back only as one of its literals (`_notAmong` names them otherwise). A recursive type's codecs call themselves. Code with no syntax behind it calls a codec as the checker finds it where the code
  stands (`lowering/boundary/codec-calls.ts`); a generic extern's wrapper finds its declared types'
  codecs and closes them within its instance, so a type parameter's codec is the witness its caller
  gave.
- What is left to natives is leaf work with no program code in it (`stdlib/json/natives.ts`,
  `definition/values/json-values.ts`): JSON text to `Json` and back (lossless-json, integers exact, nesting
  bounded by `maximumDepth` on the text before it is parsed, written as canonical JSON,
  `definition/formats/codec.ts`), a float's finiteness. A `Json` value's member is found in its union's
  layout by what each variant holds, never by a variant's name.

## Externs a host implements

A host extern is called through a compiled wrapper (`lowering/boundary/host-externs.ts`), the entry
its instance is numbered by, so its native sees only JSON:

- The wrapper encodes each argument, calls the native entry, and reads the result
  (`boundary/inbound.ts`): a result that doesn't decode panics the instance (`_hostResult`).
- The native entry keeps the declared key (`purchase.chargeCard(String, Int)`), so a host binds by
  the signature it was written against, and carries its `declaredType` (the result), which the
  runtime holds the host to across deploys (`runtime/boundary/extern-signatures.ts`).
- An extern returning `Future<T>` hands back a future the host names with a token of its own. The
  wrapper is async: it awaits the raw future and decodes, so it is an execution of its own, which
  `inspect` shows waiting at the extern's declaration. The host fills the future later
  (`Runtime.fill`), which runs the waiting wrapper in the same call, so JSON that doesn't decode
  (`_hostInput`, `_refuse`) fails the host's call and nothing commits.
- An extern constant is read through an entry that decodes the native's value; the runtime calls
  the native once per instance and pins the value in the snapshot (`pinned`).
- A host type a `dispose` makes disposable (an extern its host implements, or code passing the
  value to the host's externs) has values with an identity of their own: `_decodeHandle` keeps
  the host's JSON in a `resource` object (`definition/types.ts`, `isResourceType`), `_encodeHandle`
  gives that JSON back, and the type entry's disposal calls the `dispose` at release. It can't be
  declared sendable (5910) and, where values don't cross to the host, isn't `Encodable` or
  `Decodable`, which imply Sendable, so it crosses only to its own host; an extern constant, one
  value for every read, can't hold one (5911).
- Host natives (`runtime/boundary/host-natives.ts`) take and give JavaScript JSON, what
  `JSON.parse` of the text gives but with every integer a `bigint`, so none loses digits; what a
  host gives back is read as `JSON.stringify` would write it, `undefined` as `null` or a field
  left out (definition/values/json-values.ts). The
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
more with its arguments as JSON (`lowering/boundary/starts.ts`, `instanceLowering` in `function-lowering/index.ts`): it
decodes each argument, a mismatch failing the host's start, so the instance is one execution of the
function and its traces and waits are the function's own. `starts` lists it with its outcome's
encoder, the entry of the codec writing the declared result (`boundary/starts.ts`), which the
instance keeps for life and its segment calls with the outcome on top of the root's last frame as
it returns, so what that frame holds is disposed after (`scheduler/segment/outcome-encoding.ts`): a
finished instance keeps both, the outcome for `result()` and its JSON for the host. A `spawn` names
the codec the checker recorded for what its call gives (`checker/expressions/control/spawn.ts`), found once
in a generic body against its constraints, so its calls count in the body's expansion (§3.5). `main` is started through its own; what a host reads of an outcome is JSON by the declared result,
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

- An instance `runtime.isolate` or `testing.spawnCrashingEveryAwait` spawns has no encoder: their
  natives are given the function to spawn, not the codec of what it gives, so a host can't read
  its outcome as JSON. A `spawn` names its encoder (`lowering/expressions/calls.ts`).
