---
description: the host boundary (spec §3.6, §9) — JSON codecs as traits and derived codecs, stable identity of what a host gets, host externs and their futures, start entries, extern constants, the host API and the package's exports; read before changing externs, json, Stringable/Parsable, annotations, or how values reach a host
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-17
last_updated: 2026-11-17
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
  (`foundation/language/well-known/index.ts`, `derivedCodecs`). A recursive type counts as meeting the trait while
  its own parts are decided.
- `Encodable` and `Decodable` imply Sendable, except where values cross to the host
  (`checker/contexts/use-site.ts`, `toHost`): an extern's parameters and results, an extern constant,
  `main`'s outcome, a start entry. There only codecs count, so a disposable host type, which isn't
  sendable, crosses to its own host alone or inside other values.
- Lowering writes each derived codec's body from its form, which carries the type it takes apart
  and builds (`lowering/synthesized/boundary/encoder.ts`, `decoder.ts`, one per direction in `codecs.ts`):
  structs, enums and tuples part by part, each part through its own type's codec, a host type
  through `_encodeHandle` and `_decodeHandle`, and a literal type or union of literals through its
  base's codec, read back only as one of its literals (`_notAmong` names them otherwise). A recursive type's codecs call themselves. Code with no syntax behind it calls a codec as the checker finds it where the code
  stands (`lowering/synthesized/boundary/codec-calls.ts`); a generic extern's wrapper finds its declared types'
  codecs and closes them within its instance, so a type parameter's codec is the witness its caller
  gave.
- What is left to natives is leaf work with no program code in it (`stdlib/json/natives.ts`,
  `definition/values/json-values.ts`): JSON text to `Json` and back (lossless-json, integers exact, nesting
  bounded by `maximumDepth` on the text before it is parsed, written as canonical JSON,
  `definition/formats/codec.ts`), a float's finiteness. A `Json` value's member is found in its union's
  layout by what each variant holds, never by a variant's name.

## Identity at the boundary

A value given to a host again, unchanged, is the same frozen JavaScript object, at every depth
(spec §9, proposal 15), so a host can skip work by reference equality. Values are shared by
reference in the run, so "kept" is already "the same object"; two caches keep the
encoders from building anew:

- **One write path.** Everything a host gets is written through `json.encode<T>`: lowering's write
  call (`Checker.json.codecOf(type, 'write')`, closed at the host site, where a disposable host
  type is `Encodable`) is `encode<T>` over the type's codec, and the `json` module's container
  codecs call `encode` for each part. Caching at that call, not inside a codec, keeps a codec
  with defaulted parameters called directly with others out of it.
- **Stage 1, value to `Json`** (`definition/values/written-json.ts`): `encode`'s body asks two
  natives, `_written<T>` and `_remember<T>`, keyed by the value object and `T` (one object may be
  written as two types whose codecs differ); a handle is the run object it names. An outcome its
  root returns is written from what the root gave, not from its copy. It is kept per run, so per
  instance (`Lifetimes.written`, bound as the natives' `encodings` in `run/capabilities.ts`), since
  a codec may read a `context` constant; a test world keeps none, so a mock sees every codec call.
  A miss is `_Written.Unknown`, never `none`, which is JSON.
- **Stage 2, `Json` to JavaScript** (`plainOfJson`): each array and map inside a `Json`, not the
  union variant wrapping it, which every conversion into `Json` makes anew, keeps the frozen
  object it gave and its nesting height, so the nesting limit refuses exactly what a full walk
  would.
- **In-place writes stay sound** (`runtime/run/lifetimes.ts`): the stage-1 store is a holder,
  sharing each `Json` it keeps for good, so no part of one is changed in place; and every node an
  in-place write changes (`Lifetimes.owned`) forgets both caches' entries with its other derived
  data. A value's ancestors are on the written path, since a node held once has one
  parent. A value written is not disowned: forgetting suffices, and a push after each send stays
  in place.

## Externs a host implements

A host extern is called through a compiled wrapper (`lowering/synthesized/boundary/host-externs.ts`), the entry
its instance is numbered by, so its native sees only JSON:

- The wrapper encodes each argument, calls the native entry, and reads the result
  (`synthesized/boundary/inbound.ts`): a result that doesn't decode panics the instance (`_hostResult`).
- The native entry keeps the declared key (`purchase.chargeCard(String, Int)`), so a host binds by
  the signature it was written against, and carries its `declaredType` (the result), which the
  runtime holds the host to across deploys (`runtime/boundary/extern-signatures.ts`).
- A host's extern is unmarked or live (the checker refuses one marked `ista` or generic over its
  mark, 5913): only the runtime fills an ista future, so ista code reaches a host's live extern
  through a job (`runtime.delegate`, spec §5). One returning a future is `live async`: its wrapper
  is a live async entry awaiting the native's live future and decoding it, an execution only of a
  live run, which nothing inspects; JSON that doesn't decode panics the run.
- An extern constant is read through an entry that decodes the native's value; the runtime calls
  the native once per instance and pins the value in the snapshot (`pinned`).
- A host type a `dispose` makes disposable (an extern its host implements, or code passing the
  value to the host's externs) has values with an identity of their own: `_decodeHandle` keeps
  the host's JSON in a `resource` object (`definition/tables/types.ts`, `isResourceType`), `_encodeHandle`
  gives that JSON back, and the type entry's disposal calls the `dispose` at release. A snapshot
  keeps that JSON as an extern value's payload is kept (`externPayload`), integers exact. It must be
  an `extern shared struct` or `extern live struct`, neither a value nor `sendable` (5910),
  and, where values don't cross to the host, isn't `Encodable` or `Decodable`, which imply
  Sendable, so it crosses only to its own host; an extern constant, one value for every read,
  can't hold one (5911).
- Host natives (`runtime/boundary/host-natives.ts`) take and give JavaScript JSON, what
  `JSON.parse` of the text gives but with every integer a `bigint`, so none loses digits; what a
  host gives back is read as `JSON.stringify` would write it, `undefined` as `null` or a field
  left out (definition/values/json-values.ts). The
  runtime's API takes them as `(arguments, call)`. A host key the runtime's natives already have,
  such as `time.now()`, is refused at `createRuntime`, so no host replaces the clock. `ista run
  --host` loads a module of plain functions instead (`cli/host-module.ts`), each taking the
  arguments spread, a returned promise resolving its live future as below.
- To a live run (spec §5), which waits in memory, an extern returning a live
  future takes the resolver of the live future its call gives, `call.resolver()`, while it runs,
  and resolves it with JSON when it can, from anywhere: the value reaches the run between its
  segments. Or, taking none, it gives back a promise of its JSON, which resolves the future as it
  settles; a resolver taken is the one producer, so a promise an `async` extern gives back as well
  resolves nothing, though its rejection panics while nothing resolved the future. The resolver
  is one-shot: a second `resolve` panics the run however it stands, even in the step its root
  returned in, `tryResolve` says whether it took the value, and `onCancel` callbacks run once, at
  once, if the future is disposed first, after which it takes nothing; one registered later runs
  at once, and one that throws panics the run, never the host. A promise that rejects
  panics the run, with the trace of where the extern was called, and so does JSON that doesn't
  fit: no host call came with it to refuse. So does a resolver the host lets go of unresolved,
  naming the extern, once JavaScript collects it and every function of it (`FinalizationRegistry`),
  and an extern that gives back no promise and takes no resolver, at once. So does a resolver
  taken for no future of its call: by an extern not returning one, or once the extern returned.

## Starting runs

A startable function (top-level, not generic, extern or ista code, or a constant holding a sendable
lambda that isn't ista code; by-value parameters that can be read, an outcome that can be written;
the rule is `foundation/language/starts.ts`'s, which the compiler, the checker, lowering and the
Definition's validation read) gets a start, listed in the Definition's `starts` under its key with
two entries (`lowering/synthesized/boundary/starts.ts`):

- `function` decodes each argument from `Json`, a mismatch failing the host's start before anything
  runs, and calls the function, giving what it gives: an async one's future, unawaited.
- `encode` writes the outcome as `Json` with the codec of the declared result. The runtime calls it
  the moment the root's outcome settles, and the live run finishes then (spec §10): nothing readied
  meanwhile runs, and what `main` held was disposed as it returned. An outcome JSON can't hold, one
  nesting too deep, refuses the start once the run finished (`checkJsonOut`).

A start is live or simple code, its head's mark (spec §3.3): ista code runs only in an instance, a
context live code calls, so `main` is `live async fn main()`. A spawned instance whose outcome's type a codec
writes encodes it as it finishes (its `Instance<T>` entry's `encoder`, docs/arch/runtime.md), and a
host reads that JSON as text (`host/programs.ts`, `outcomeText`); any other outcome reads as a
primitive's text. What a host reads of a start's outcome is its encoded JSON, as JavaScript values or
as text, which `ista run` prints.

The host API (`runtime/host/index.ts`, `createRuntime`) deploys an encoded Definition (`deploy`),
giving its program (`runtime/host/programs.ts`), whose `start` runs a function by key with JSON
arguments as a live run named by the host; the `Runtime` wakes a stored instance (`wake`), reads
its program and where it stands (`programOf`, `inspect`), and operates panicked instances: `retry`
runs the failed segment again from where the instance stood before it, at the time it first
started, replaying the call that started it; `terminate` disposes what it held then and commits it
holding nothing (docs/arch/runtime.md). Each call that runs code starts on a turn of its own, so one
a host's extern makes into the runtime starts once the call it was made in ended. No host fills an instance's future: what reaches an
instance from outside is a call into it as a context, a delegated job's result among them
(`runtime.delegate`). A host names only its live runs, which never reach the store; the store's
instances are contexts, named by the program's keys, and the instances they spawn, `<parent>/<n>`.

## The host contract

The host API (`runtime/host/index.ts`) is asynchronous: every call that runs code (`start`,
`wake`, `retry`, `terminate`) gives a promise, and a refusal rejects it, so a host awaits the same
way whatever the code waits on. The others (`deploy`, `programOf`, `inspect`, `outcomeText`)
answer at once. How the instances run is docs/arch/runtime.md's.

- **Residency.** A runtime keeps each instance it runs in memory (`host/durable-world.ts`,
  `Resident`): its next segment runs on the instance its last segment committed, and every commit
  is written to the store before its effects leave it (§5). An instance the runtime doesn't hold is
  read from the store with the Definition its snapshot names.
- **The store's one driver.** While a runtime runs, it is its store's only driver: a store changed
  under it is seen only by a runtime opened after (a restart, §5).
- **Live runs.** A host starts live or simple code only (`host/programs.ts`), refusing an `ista`
  entry (`notStartable`), and runs it outside any instance, in memory: `start` settles the moment
  its root call's outcome settles, and nothing of the run reaches the store. Its waits ride the
  host's event loop: its timers on the runtime's `Clock`, its host futures on the host's promises.
  Its name is what `runtime.id()` reads.
- **Contexts.** A live run drives the instances it reaches in its own loop: a call into a context
  is a segment of the context, whose answer its commit carries to the live future; spawned instances
  run as far as they can, and keep running after the live run finished until nothing is ready. What
  they report reaches the host through `HostReports`: log records, and a panic no call waits to
  hear.

## Packages

`istalang/runtime` (the host API) and `istalang/stdlib` (the std natives) are subpath exports, each a
tsdown entry. Their declarations come from TypeScript itself (`tsconfig.declarations.json`):
tsdown's declaration plugin needs TypeScript's JS API, which TypeScript 7 lacks, or isolated
declarations, which the definition layer's schemas aren't.
