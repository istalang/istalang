---
description: inventory (2026-11-16) of the std natives (216), the native seam (`runtime/natives.ts`) as each runtime builds it, the host boundary, which natives could become std `.ista` and the minimal primitive set an LLVM runtime must implement, JS-defined std semantics, and ranked clean-dev violations — read before moving natives into Istalang, changing the native or host contract, or planning a non-JS backend
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [natives, stdlib, boundary, host, runtime, live, codegen, llvm, ir-first, research]
---

# Natives and the host boundary (IR-first research)

Read-only evidence for the IR-first refactor: every backend (interpreter, compiled JS in `src/live` +
`src/codegen`, a planned LLVM backend, `docs/work/linker/native-binary.md`) runs one Definition IR,
lowering decides, backends execute primitives. Lifetime facts of natives (`ValueChanges`, `@Keeps`/
`@Holds`, crossing) are in `lifetimes-inventory.md` §5 and are only cited here.

Legend: **P** pure value function, **C** needs a runtime capability, **I** interpreter-only.
Counts come from loading `stdModules` (`src/stdlib/std-modules.ts`) and listing each module's
`natives` and `interpreterKeys`.

## 1. Inventory: 216 std natives

| Module | Total | I | C | P | Notes |
|---|---|---|---|---|---|
| prelude | 100 | 6 | 18 | 76 | 45 arithmetic/bitwise/conversion, 17 array, 11 map, 2 range, 6 string-as-sequence, 4 weak, 6 waits, 6 text forms, panic, `_trace` |
| decimal | 34 | 0 | 0 | 34 | over `decimal.js` (`decimal/arithmetic.ts`, 259 LOC) |
| strings | 19 | 0 | 0 | 19 | JS string methods, `Intl.Segmenter` |
| time | 16 | 0 | 2 | 14 | `now`, `at`; zones over `temporal-polyfill` (`time/zones.ts`) |
| runtime | 11 | 7 | 3 | 1 | `id`, `version`, `commit` C; `_raise` P |
| regex | 8 | 0 | 0 | 8 | `re2js`, module-level `LRUCache` of compiled patterns |
| testing | 8 | 8 | 0 | 0 | |
| json | 7 | 0 | 4 | 3 | `_written`/`_remember` (encodings), `_encodeHandle`/`_decodeHandle` (resources) |
| math | 5 | 0 | 0 | 5 | |
| crypto | 5 | 0 | 0 | 5 | `@noble/hashes` |
| random | 2 | 0 | 2 | 0 | |
| log | 1 | 0 | 1 | 0 | |
| **all** | **216** | **21** | **30** | **165** | `collections`, `fanout`, `futures`, `inbox`, `lifetimes`, `rpc` are pure `.ista` (0 natives) |

`docs/work/linker/README.md` ("The four executors") still says "203 natives": stale.

**C natives by capability** (`runtime/natives.ts` `With*` interfaces):
- `waits` (6): `onAwait`, `resolve`, `tryResolve`, `Resolver.of`, `Resolver.at`, `onCancel`.
- `weak` (4): `WeakRef.from`, `deref`, `disposed`, `disposing`.
- `changes` (7, the `&` natives): array `push`, `pop`, `reverse`, `setIndex(Int)`, `setIndex(Range)`; map `delete`, `setIndex`.
- `futures` (2): `time.at` (`timer`), `runtime.commit` (`resolved`); host externs use `resolvable`.
- context fields (5): `time.now` (`now`), `runtime.id` (`instance`), `runtime.version` (`version`), `prelude._trace` (`callerTrace`); `_raise` reads `trace` via Panic.
- `random` (2): `random.integer`, `random.uuid` (`draw`). `logs` (1): `log.write`.
- `encodings` (2), `resources` (2): the json ones above.

**Typed-value building inside "pure" natives.** ≈70 of the 165 P natives read `context.types`,
`resultType` or `typeArguments` to build or read an `Optional`, `Result`, struct or enum variant
(`stdlib/values/results.ts`: `resultOptional`, `resultOk`, `okStruct`, `parseResult`,
`resultVariant`; `stdlib/values/arguments.ts`: `variantEntry`, `optionalInt`). Heaviest: decimal
(~28), time (~14), regex (7), crypto (5), prelude arrays/strings/ranges/text forms (~12). A non-JS
backend reimplementing them needs the type tables and the language's value layout per native.

## 2. Interpreter-only natives (21) and why

`ModuleNatives.interpreter` (`stdlib/std-module.ts`) → `StdModule.interpreterKeys` →
`interpreterNativeKeys` (`stdlib/natives.ts`) → `codegen/emit.ts` `interpreterOnly` refuses the
program. None is interpreter-only for its own semantics; each needs something only the durable
runtime has:

| Group | Natives | .ista mode | Needs |
|---|---|---|---|
| instances | `prelude.spawn`, `prelude.result`, `runtime._isolated`, `testing.spawnCrashingEveryAwait` | `extern ista` | commits, snapshots, `crossing.ts` copy-on-cross |
| slots | `Slot.create`, `put`, `take`, `read` | `extern ista` | `scheduler/instance/slots.ts`, persisted futures |
| contexts | `hostStore`, `_Runtime.open`, `_call`, `_jobCall`, `_served`, `_jobServer` | `extern live` | a durable runtime inside a live run (`scheduler/run-contexts.ts`) |
| testing | `_mock`, `_calls`, `idle`, `reaches`, `waitingAt`, `state`, `handle` | `extern ista` or plain `extern fn` | the test world (`runtime/testing/`), mocks consulted before the function table |

Root cause: ista-mode code runs only on the interpreter (`emit.ts` refuses every `mode === 'ista'`
entry). Under "every backend executes the same IR", instances/slots/commit become runtime
primitives each durable backend implements (the README requires snapshots of every executor);
testing stays a host/test-world concern. Slots are a candidate for `.ista` over the waits
primitives: `futures.ista` already builds `First`/`All` over `onAwait` + `Resolver.at`, and
`inbox.ista` builds on a slot. Unverified: slot queue order and "a receive that loses a `select`
consumes nothing" (§6) would need `onCancel`.

## 3. What could be `.ista` (every backend compiles it) vs must stay native

`.ista` candidates (≈95), with the primitives each would use:

| Natives | Count | Over |
|---|---|---|
| Mixed `Int`/`Float` overloads of add/subtract/multiply/divide/compare/power, `divide(Int, Int)` (`stdlib/numeric.ts` `numeric`: converts the int with `asFloat`, then runs the float op) | 17 | `Float.from(Int)` + float ops |
| `toString(Bool)`, `Bool.parse` | 2 | string compare |
| Array `indexOf`, `lastIndexOf`, `includes`, `flat`, `join`, `at`, `slice`, `index(Range)`, `setIndex(Range)`, `_patternRest`, `reverse` | 11 | `length`, `index`, `push`, `setIndex(Int)`, `==` |
| Map `has`, `includes`, `keys`, `values`, `entries` | 5 | `size`, `_entryAt`, `get` |
| Range `_steps`, `includes` (`stdlib/ranges.ts`, `positions.ts`: pure arithmetic) | 2 | Int ops |
| String `at`, `includes`, `index(Range)`; strings `lastIndexOf`, `startsWith`, `endsWith`, `slice`, `split`, `padStart`, `padEnd`, `repeat`, `replace`, `replaceAll`, `format` | 14 | code-point `length`/`index`/substring, `indexOf`, concat |
| math `abs` ×2, `round(Float, Rounding)` (`math/rounding.ts`) | 3 | `floor`/`ceil`/`trunc` primitives |
| decimal: all 34 | 34 | `Int` (bigint) coefficient + scale; deletes `decimal.js`, `arithmetic.ts` and `decimal/natives.ts` (387 LOC) and its workarounds (text writing, power size checks) |
| random `integer`, `uuid` | 2 | one `draw` primitive (draws are HMAC-SHA-256, `runtime/random-draws.ts`, already portable) |
| time ISO text/parse of `Time` and `Duration` (`time/iso.ts`) | ~4 | Int arithmetic |

Cost to weigh: on the interpreter a per-element `.ista` loop dispatches per instruction where a
native runs one JS call; compiled JS and LLVM compile the loop. Measure `includes`/`join` first.

**Minimal native set an LLVM runtime must implement** (after the moves; ≈85 including libraries):
- `Int` (bignum, two's-complement bitwise as bigint): add, subtract, multiply, floorDivide,
  remainder, power, compare, negate, 6 bitwise, `toString`, `parse`, `Float.from`, `Int.from`.
- `Float` (IEEE 754): add, subtract, multiply, divide, compare (NaN compares equal, `prelude/natives.ts` `sign`), power, negate, sqrt, floor/ceil/trunc, `toString`, `parse`.
- `String`: code-point length, index, `_characterAt`, substring, concat, compare (UTF-16 order), `indexOf`, case mapping, graphemes, trim set, `utf16Length`.
- `Array`: length, index, push, pop, `setIndex(Int)`, splice, default. `Map`: size, get, index, `setIndex`, delete, `_entryAt`, default (key equality: `definition/values/equality.ts`).
- Waits (6), weak (4), timer, `commit`; effects: `now`, `draw`, `log.write`, `id`, `version`, `panic`, `_trace`.
- JSON text `_read`/`_write`, `_refuse`, encodings (2), host payloads (2).
- Libraries: RE2 (C++ RE2 exists), SHA-1/2 + HMAC + base64/hex, an IANA tz database.
- Durable runtime only: instances (4), slots (4, unless `.ista`), contexts (6); testing (8) belongs to the test world.

## 4. Std semantics defined by JavaScript (README "Shared prerequisites" 3)

A non-JS backend must match these bit for bit; each is defined today by the JS engine or a JS library:
- **Float text:** `String(number)` shortest round-trip plus `.0` for whole numbers; `NaN`/`Infinity` spelled as JS spells them (`prelude/text-forms.ts` `primitiveText`). `Float.parse`: JS number syntax regex + `Number()`.
- **String order:** `<` on JS strings = UTF-16 code units (`foundation/language/order.ts` `compareOrdered`); also canonical JSON key order (§9). A UTF-8 runtime must emulate it.
- **strings:** `trim*` use JS's WhiteSpace+LineTerminator set; `toUpperCase`/`toLowerCase` and `graphemes` (`Intl.Segmenter`) follow the engine's Unicode/ICU version, so two Node versions can disagree, despite §3.8's "a re-run segment always computes the same"; `utf16Length`; `indexOf`'s `from` converts through UTF-16 offsets.
- **regex:** `re2js` engine; replacement `$1`/`$<name>`/`$&`/`$$` "as JavaScript does" (§3.8).
- **JSON:** NaN/±Infinity written as `null`, numbers as `String(number)` (`definition/values/json-values.ts`).
- **time:** `Time` text is `Date.toISOString`/`toJSON`; `Duration` text is `Temporal.Duration`'s; zones are `temporal-polyfill` over the host's `Intl` tz data ("two hosts with different data can disagree", §3.8).
- **math rounding:** `Math.round`-based ties (`math/rounding.ts`). **decimal:** `decimal.js` behaviour (34-digit half-even division, floored `%`).
- **limits:** `panicOf` (`runtime/natives.ts`) matches V8 `RangeError` messages ("Invalid string length", "Maximum call stack size exceeded"…). The interpreter allows 200,000 heap frames; compiled JS stops at the JS stack (`live/run.ts` banner): limits already differ per backend.
- **host values:** §9 defines the host contract in JS terms ("as `JSON.parse` gives it … every integer a `bigint`", "Stable references … the same JavaScript object").

## 5. The native seam: one contract, two builders

- **One type:** `Native = (argumentValues, context) => Value`, `FullNativeContext = NativeContext & NativeCapabilities` (11 capabilities), errors as thrown `Panic`/`Refusal`; `requireNatives` refuses missing keys in both (`interpreter/function-table.ts`, `live/program.ts`).
- **Two builders of it:** interpreter `scheduler/segment/native-calls.ts` (`NativeCalls`, `capabilitiesOf`, 284 LOC) + `native-contexts.ts` (130); compiled `live/natives-context.ts` (`boundExtern`, `runCapabilities`, `resolvable`, 215). Each adapts its own runtime objects (`Waits`, weak side, heap vs `Resource`/`Future` classes) to the same interfaces.
- **Divergences in the seam itself:**
  - Context: per call by spreading the segment's (interpreter) vs once per extern per run (live).
  - Extern constants pinned per instance, persisted (`instance.effects.pinned`) vs per run in a closure (`boundExtern`).
  - `encodings`: interpreter keeps written JSON (`instance.holders.written`, none when mocking); live `new WrittenJson(() => undefined)`, justified "Compiled code changes no value in place". The rule "an in-place change forgets what a value was written as" lives only in the interpreter's `InPlace` (lifetimes-inventory §5).
  - `changes`: in place when unique (interpreter `InPlace.changesAt`) vs always copy (`live/values/place.ts` `Place.changes`): lifetimes-inventory §5.
  - Audit: `NativeCalls.#checked` runs `HeapCheck.native` (the checker's keeps/holds table) around each interpreter native call; compiled calls are never audited.
  - `trace`/`callerTrace`: frames (interpreter) vs parsing `new Error().stack` (`live/traces.ts`); an LLVM backend needs a third.
- **Keeps/holds** (`@Keeps`, `@Holds`, §3.16) live only in the checker (`compiler/checker/rules/lifetimes/externs.ts` `keepsOf`, `externHeldOf`); the Definition carries neither (lifetimes-inventory §5; `ir-first/design.md` (decision 4) puts them in the extern entry).

## 6. Host boundary: one contract for JS backends, none yet for native code

- **Shared by both runtimes** (`runtime/boundary/`): `withHost` (host externs as natives, shadowing refused), `hostNative` (JSON in/out, live futures via `resolver()` or a returned promise, `FinalizationRegistry` for dropped resolvers), `starts.ts` `startOf`/`jsonIn`, `outbound.ts` `outcomeJson`/`outcomeText`. `extern-signatures.ts` `recordExternSignatures` is durable-only (store).
- **Two host entry shapes for one concept** (start a function by key with JSON):
  - interpreter `runtime/host/index.ts` `createRuntime({natives, host, clock, seed: () => Uint8Array, store, …})`, then `deploy`, `start(run, {function, arguments})`, outcome read through `outcome(finished)`;
  - compiled `live/program.ts` `program(tables).start({function, arguments, externs, name, clock, seed: Uint8Array})` → `LiveEnded{kind, outcome, text, logs}`.
  Externs are given per runtime vs per start, seeds as factory vs bytes, and live imports `stdNatives` directly where the interpreter's composition root injects natives.
- **Portability:** `HostExtern = (arguments: unknown[], call: HostCall) => unknown` is a JS function over JS JSON values (bigint integers); an LLVM backend needs a C-ABI form. The JSON text form (`jsonText`, `outcomeText`) is the portable contract to anchor it on.

## 7. Clean-dev violations

| # | Rule | Where | Evidence | Blast radius | Fix direction |
|---|---|---|---|---|---|
| V1 | DRY, double standard | `scheduler/live-resolvers.ts` `LiveResolver` vs `live/natives-context.ts` `resolvable` | one state machine (`pending`/`resolved`/`cancelled`, `tryResolve`, `fail`, `panic`, `onCancel`, the same "A host's onCancel threw" panic) written twice; the live banner says "as the interpreter's does" | every host-future rule edited twice; drift caught only where differential tests reach | one resolver in `runtime/` over a `{settle, fail, onDisposed}` seam, built by both runtimes |
| V2 | Double standard, single source of truth | `std-modules.ts` everywhere/interpreter split; `Natives<Context>` parameters (`WithSlots`, `WithInstances`, `WithTesting`, `WithContexts`); `.ista` extern modes | three hand-kept classifications that disagree: `runtime.commit` is `extern ista` but "everywhere"; contexts are `extern live` but interpreter-only; `testing._mock`/`waitingAt`/`state`/`handle` are plain `extern fn` but interpreter-only | a new std native needs three places right; the split goes away only if all three are found | derive "runs where" from one declaration (capabilities per extern, carried in the Definition); with IR-first, eliminate the class by giving every durable backend the capabilities |
| V3 | ISP, dead code, double guard | `live/natives-context.ts` `runCapabilities` | 14 `interpreterOnly` stubs for slots/instances/contexts/testing exist only because every native gets `FullNativeContext`; unreachable since `emit.ts` refuses those keys first (two guards, one rule) | each new capability adds stubs to every backend that lacks it | bind natives to the capabilities they declare and check them at bind time (`requireNatives`' sibling), so a backend lacking one refuses at load |
| V4 | Contracts carry layout | `stdlib/values/results.ts`, `arguments.ts` | ≈70 P natives build `Optional`/`Result`/struct/enum values from `context.types`/`resultType`/`typeArguments` | every non-JS backend reimplements typed construction per native | natives take and give primitives, tuples and arrays; `.ista` wrappers build `Optional`/`Result`/enums (as `json.ista` already wraps `_read`) |
| V5 | Rule split across layers, stale-comment risk | `live/natives-context.ts` `encodings`; interpreter `InPlace` | "forget written JSON on in-place change" exists only in the interpreter; compiled code's correctness rests on "changes no value in place" (P3 in place will falsify it) | stale identity cache at the host boundary (§9 stable references) once compiled in place lands | make the forget part of the in-place IR primitive in every backend |
| V6 | DRY (cited) | `InPlace` vs `Place.changes`; keeps/holds checker-only; `heldBy` vs `HolderWrites` | lifetimes-inventory §5 | — | `ValueChanges` as IR primitives; keeps/holds in the extern entry; the native audit then applies to both backends |
| V7 | Double standard | `runtime/host/index.ts` + `host/programs.ts` vs `live/program.ts` | two start APIs for one concept (§6 above); live hard-wires `stdNatives` (DIP: no injection for tests or a host's own std) | every host-facing change made twice; hosts learn two APIs | one `HostBinding {natives, externs, clock, seed}` both entries take; live takes natives from its caller |
| V8 | DRY (minor) | `capabilitiesOf` vs `runCapabilities`; log stamping `{instance, time: now(), ...entry}`; constant pinning | the same capability assembly and per-capability rules written per runtime | small now; grows per capability | one context builder over a runtime-objects seam once runtime objects unify (`ir-first/design.md` (decision 4), "One copy of runtime objects' rules") |
| V9 | Backend-surface multiplier | `stdlib/numeric.ts` `numeric`; decimal `mixed` | 17 mixed numeric natives and 12 Decimal/Int pairs are conversions plus one op; DRY in TS, but each backend implements every overload | ×4 / ×3 natives per op on each new backend | `.ista` overloads over `Float.from`/`Decimal.from` |
| V10 | Comment rot | `live/natives-context.ts` banner | "Instances, contexts, slots and testing are … ista's (proposal 8, Rule 6): the checker keeps live code from them": false for contexts (`extern live`) and the plain-`extern fn` testing natives | misleads the next reader on why compiled code refuses them | restate: refused because only the interpreter has them (`emit.ts`) |
| V11 | Doc drift | `docs/work/linker/README.md` | "203 natives" vs 216 | sizing of a native runtime | update the count, or drop it for "the std natives" |

Not violations: `regex/natives.ts`'s module-level `LRUCache` memoizes compiled patterns by their
text (derived, keyed by its input); `json` codecs are synthesized by lowering
(`compiler/lowering/synthesized/boundary/`), which already matches "lowering decides".

## 8. Ranked refactors (most leverage first)

1. **Natives speak primitives** (V4): result building moves to `.ista` wrappers; it shrinks every later step and every future backend's native code.
2. **Move the ≈95 `.ista` candidates** (§3, V9), decimal first (34 natives, deletes `decimal.js`); measure interpreter cost on array/string loops.
3. **One capability declaration** (V2, V3): carried per extern in the Definition, checked at bind time; removes `interpreterNativeKeys`, the `everywhere`/`interpreter` split and the stubs.
4. **One resolver, one context builder** (V1, V8) in `runtime/`, ahead of the runtime-object unification in `ir-first/design.md` (decision 4).
5. **In-place and keeps/holds in the IR** (V5, V6), with the written-JSON forget inside the in-place primitive.
6. **One host binding** (V7) shared by `createRuntime` and `program`; then a JSON-text C ABI for native backends.
7. **Settle JS-defined semantics in the spec** (§4): float text, UTF-16 order, the Unicode version for case mapping and graphemes, tz data, limits; add golden vectors to the conformance suite.
