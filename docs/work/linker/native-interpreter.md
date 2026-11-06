---
description: the runtime rewritten in Rust or C, still interpreting the Definition — what it gains (no Node, a static binary, embedding), the use cases it enables, what porting the runtime and the std natives takes, and the changes our code and spec need first; read before targeting edge devices, mobile, embedding or no-Node deployment
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [runtime, executors, native, interpreter, embedding, edge]
---

# Native interpreter

A runtime in Rust or C that loads the same Definition text and reads and writes the same snapshots, interpreting the instructions as `interpreter/instructions.ts` does. The compiler stays TypeScript, and a Definition built once runs on either runtime.

## Gains

- **No Node.** A small static binary, cross-compiled to ARM and other targets.
- **Embeddable** through a C ABI, in Rust, Go, Swift, Kotlin or C++ applications.
- **Fast cold start and a small memory footprint** per process.
- **Faster at what JavaScript makes slow:** small integers without `bigint`, decimals in a native library, and a faster codec for the canonical JSON of snapshots.

Code still runs at interpreter speed. For CPU-bound segments, see `native-binary.md`.

## Use cases it enables

- **Edge and IoT devices:** chargers, POS terminals, gateways, firmware-update agents. Sessions and offline queues survive reboots.
- **Robotics, lab automation and industrial sequencing.** A multi-day protocol survives a power loss or an emergency stop and resumes at its last step.
- **Mobile and desktop embedding:** resumable sync and uploads that survive the OS killing the app.
- **Durable CLI and infrastructure tools:** provisioning, installers, deploy tools that resume after Ctrl-C or a crash.
- **Durable actors at density,** where cold start and memory per process dominate.

## What porting takes

All of this is new code, sized by today's TypeScript (non-test lines):

| Part | Today | Native counterpart |
| --- | --- | --- |
| `runtime/` | 6.9k lines: scheduler 3.1k, interpreter 0.7k, snapshot 0.7k, lifetimes 0.6k, testing 0.6k, boundary 0.2k | The same structure: segments, futures, slots, weak references, the collector, mocks and test worlds |
| `definition/` | 2.9k lines: zod schemas, canonical JSON, validation of indexes and code | The same validation, against schemas exported from zod |
| `language/values.ts` | `==`, map keys, the order of ints and strings | Ported exactly, checked by golden vectors |
| Std natives | 203: prelude 93, decimal 34, strings 19, time 16, regex 8, testing 8, json 7, crypto 5, math 5, runtime 4, random 2, futures 1, log 1 | Each by its extern key (`definition/extern-key.ts`) |
| Libraries | decimal.js, re2js, temporal-polyfill, `node:crypto`, lossless-json | A decimal library with 34-digit half-even division (libmpdec), RE2, ICU or tzdata, a crypto library, a canonical JSON writer |

## Changes to our code and design

- **A conformance spec.** Export the zod schemas of the Definition and snapshot formats (`definition/formats/format.ts`, `codec.ts`, `runtime/snapshot/`) as JSON Schema. Add golden vectors for canonical JSON, `language/values.ts`, and the text of `Int`, `Float`, `String` and `Decimal`.
- **Std semantics settled in the spec, not by JavaScript.** Today's text follows JavaScript in several places:
  - a primitive's text is `String(value)` (`stdlib/prelude/text-forms.ts`);
  - regex replacement expands `$1` "as JavaScript does";
  - `strings` takes JavaScript's names;
  - JSON keys sort in UTF-16 order (§9).

  Either specify each exactly, or keep JavaScript's behaviour and port it to the letter.
- **A runtime seam for tests.** `ista test` and the end-to-end corpus run the TS runtime (`runtime/testing/`). Let them run a Definition on another runtime and compare outcomes, commits and traces.
- **A host ABI.** A host is a JavaScript module today (`cli/host-module.ts`), but the boundary contract is already JSON (docs/arch/boundary.md). Keep the contract, and add a C ABI or a subprocess protocol for it.
- **Optionally, fewer natives.** Move natives that are pure logic into `.ista`, as the prelude's methods taking functions already are (architecture.md, Decisions). That shrinks what each runtime ports.

The compiler, the Definition and lowering need no change.

## Risks

- **Two runtimes to keep in step,** for every runtime feature from now on, unless the TS one becomes reference-only.
- **Determinism across runtimes,** if one store serves both. Every rounding, text and ordering difference shows up as a re-run that disagrees.
