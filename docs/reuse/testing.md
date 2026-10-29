---
description: phase test kits, fast-check arbitraries, spec-example extractors, corpus runners and Definition fixtures — read before writing or editing tests
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-10-29
tags: [reuse, testing, test-kit, arbitraries, fast-check, corpus]
---

# Test kits, arbitraries and corpus helpers

## Units

- assert reported diagnostic codes and span texts in any phase test → `reportedIn`, `reportedNothing`, `reportedOnce` (`src/diagnostics/diagnostic.test-kit.ts`)
- scan source text in tests or list non-`end` tokens → `scanText`, `lexemes`, `kindsAndTexts`, `soleToken` (`src/compiler/scanner/scan.test-kit.ts`)
- check scanner losslessness or malformed-line recovery → `losslessnessViolations`, `scanMalformed`, `scannedPast` (`src/compiler/scanner/scan.test-kit.ts`)
- dump a `SyntaxNode` as an S-expression → `dump` (`src/compiler/syntax/tree.test-kit.ts`)
- read every corpus module, programs and module corpora alike → `corpusFiles` (`test/corpus/programs.ts`)
- run a property over every corpus file and spec example that parses clean, or explain a line past the width → `formattableInputs`, `parseText`, `commentTexts`, `unexplainedLongLines` (`src/formatter/format.test-kit.ts`)
- check syntax tree span nesting or list error nodes → `spanViolations`, `errorNodes` (`src/compiler/syntax/tree.test-kit.ts`)
- parse a single grammar category or dump a clean parse → `parseAs`, `dumpClean`, `reported`, `lines` (`src/compiler/parser/parse.test-kit.ts`)
- generate random token soup in parser tests → `tokenSoup`, `parenFreeSoup` (`src/compiler/parser/parse.test-kit.ts`)
- generate random operator trees → `operatorTree`, `printFull`, `printMinimal`, `shapeOf` (`src/compiler/parser/expressions/precedence.test-kit.ts`)
- make a real project on disk, removed after the test → `tempProject` (`src/project/project.test-kit.ts`)
- talk LSP to a language server in memory (open, change, close documents; await published diagnostics; read highlighting decoded) → `connectedClient`, `TestClient` (`src/lsp/server.test-kit.ts`)
- run a property over every corpus and std module open in one language server → `corpusClient`, `corpusDocuments` (`src/lsp/corpus-client.test-kit.ts`)
- ask a language server for definitions or references by position, against the corpus project loaded apart → `definitionsAt`, `referencesAt`, `namesOf`, `positionOf` (`src/lsp/providers/navigation.test-kit.ts`)
- write a navigation test over in-memory modules, finding names as written and applying rename edits → `navigable`, `placeOf`, `edited` (`src/language-service/navigation/navigation.test-kit.ts`)
- parse a few lines as a module for a language-service feature's test → `treeOf` (`src/language-service/language-service.test-kit.ts`)
- parse a few lines as a module for a language-service feature's test, or check them beside the std modules with a cursor marked `‸` → `treeOf`, `programAt` (`src/language-service/language-service.test-kit.ts`)
- state what a language server must answer over the corpus, from the corpus project loaded apart, and its open documents there → `corpusProgram`, `programDocuments`, `ProgramDocument` (`src/lsp/corpus-client.test-kit.ts`)
- tell whether a resolved name was looked up in scope (not a qualified tail, a declaring name, an ADL callee or an own call) → `isLookedUp` (`src/compiler/binder/bind.test-kit.ts`)
- build an in-memory `Program` or `ModuleLoader` → `programOf`, `memoryLoader`, `idOf`, `moduleAt`, `loadedPaths` (`src/compiler/program/program.test-kit.ts`)
- build a `Program` with the prelude or all std modules (cached) → `preludeProgramOf`, `stdProgramOf`, `boundReport` (`src/compiler/binder/bind.test-kit.ts`)
- inspect bound entities by name occurrence in source order → `namesIn`, `entityOfName`, `declaringName` (`src/compiler/binder/bind.test-kit.ts`)
- sweep every name the binder resolved over the corpus and std modules → `boundCorpus`, `resolvedNames` (`src/compiler/binder/bind.test-kit.ts`)
- check a `main.ista` snippet with all std modules or wrap statements in a function → `reported`, `inFunction` (`src/compiler/checker/check.test-kit.ts`)
- check a rule across every std module at once → `everyStdModule` (`src/stdlib/std-modules.test-kit.ts`)
- compile in-memory sources to a `Definition` or its text → `compiledDefinition`, `compiledText`, `diagnosedAt` (`src/compiler/compile.test-kit.ts`)
- create a test `Runtime` with manual clock and store → `testRuntime`, `manualClock`, `recordingStore`, `testSeed` (`src/runtime/runtime.test-kit.ts`)
- advance a test `Runtime` instance and its spawns until settled → `settleAll`, `runToEnd`, `startToEnd` (`src/runtime/runtime.test-kit.ts`)
- ignore `Futures` events in unit tests → `ignoredEvents` (`src/runtime/scheduler/futures.test-kit.ts`)
- compile and run `main()` for a prelude expression snippet → `mainGives` (`src/stdlib/prelude/prelude.test-kit.ts`)
- compile and run an `.ista` test module in memory on a manual clock → `reportsOf`, `outcomesOf`, `testModule` (`src/runtime/testing/testing.test-kit.ts`)
- run the `ista` CLI in-process without spawning a child process → `runCli` (`src/cli/cli.ts`), `exitCodes`, `CliEnvironment` (`src/cli/command.ts`)
- generate random token/fragment soup or randomly mutated valid programs → `soupOf` (`test/soup.ts`), `brokenText` (`test/broken.ts`)
- generate random `Value`s or deeply nested values → `valueArbitrary`, `nested` (`src/definition/values.test-kit.ts`)
- generate canonical JSON values or non-canonical JSON texts → `exactJson`, `reverseKeys`, `looseText` (`src/definition/codec.test-kit.ts`)
- generate random load-valid `Instruction`s → `instruction` (`src/definition/instructions/instruction.test-kit.ts`)
- generate random load-valid `Definition`s or edit the subset fixture → `definitionArbitrary`, `editedSubset` (`src/definition/definition.test-kit.ts`)
- mutate persisted format JSON or assert format refusal messages → `editedText`, `refusalOf` (`src/definition/format.test-kit.ts`)
- generate random `Heap` graphs and check naive reachability → `heapArbitrary`, `reachedFrom`, `testTypes` (`src/runtime/lifetimes/lifetimes.test-kit.ts`)
- read fenced code examples from `docs/spec.md` and `docs/guide.md` → `specExamples`, `specCode`, `isPlaceholder` (`test/corpus/spec-examples.ts`)
- load `test/corpus/` valid/invalid programs → `runPrograms`, `invalidPrograms`, `corpusDirectory` (`test/corpus/programs.ts`)
- build hand-written `Definition` fixtures → `spanOf`, `noSpan`, `sourceModule`, `externFunction`, `named` (`test/definitions/fixture-kit.ts`)
- use pre-built `Definition` fixtures → `subsetDefinition` (`test/definitions/subset.ts`), `broadcastDefinition` (`test/definitions/broadcast.ts`)

## One-way rules

- Test helpers in `*.test-kit.ts` return observations (such as `Reported` or `Ended`) and never call `expect(...)` themselves, so assertions stay in the test.
- Tests needing std modules use `stdProgramOf` (`src/compiler/binder/bind.test-kit.ts`), which parses the std modules once per test file and reuses their trees.
- Never copy spec example code into a test file; extract it by section heading with `specCode` / `specExamples` (`test/corpus/spec-examples.ts`).
