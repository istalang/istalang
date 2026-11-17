---
description: phase test kits, fast-check arbitraries, spec-example extractors, corpus runners and Definition fixtures — read before writing or editing tests
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-13
last_updated: 2026-11-17
tags: [reuse, testing, test-kit, arbitraries, fast-check, corpus]
---

# Test kits, arbitraries and corpus helpers

## Units

- assert reported diagnostic codes and span texts in any phase test → `reportedIn`, `reportedNothing`, `reportedOnce` (`src/foundation/diagnostics/diagnostic.test-kit.ts`)
- scan source text in tests or list non-`end` tokens → `scanText`, `lexemes`, `kindsAndTexts`, `soleToken` (`src/compiler/scanner/scan.test-kit.ts`)
- check scanner losslessness or malformed-line recovery → `losslessnessViolations`, `scanMalformed`, `scannedPast` (`src/compiler/scanner/scan.test-kit.ts`)
- dump a `SyntaxNode` as an S-expression → `dump` (`src/compiler/syntax/tree/tree.test-kit.ts`)
- make nodes or spans by hand, in a segment that starts the text → `handMadeSpan` (`src/compiler/syntax/tree/tree.test-kit.ts`)
- read where a node of a program's module stands in its text → `textSpanOf` (`src/compiler/program/program.test-kit.ts`)
- read every corpus module, programs and module corpora alike → `corpusFiles` (`test/corpus/programs.ts`)
- run a property over every corpus file and spec example that parses clean, or explain a line past the width → `formattableInputs`, `parseText`, `commentTexts`, `unexplainedLongLines` (`src/formatter/format.test-kit.ts`)
- check syntax tree span nesting or list error nodes → `spanViolations`, `errorNodes` (`src/compiler/syntax/tree/tree.test-kit.ts`)
- parse a single grammar category or dump a clean parse → `parseAs`, `dumpClean`, `reported`, `lines` (`src/compiler/parser/parse.test-kit.ts`)
- generate random token soup in parser tests → `tokenSoup`, `parenFreeSoup` (`src/compiler/parser/parse.test-kit.ts`)
- generate random operator trees → `operatorTree`, `printFull`, `printMinimal`, `shapeOf` (`src/compiler/parser/grammar/expressions/precedence.test-kit.ts`)
- make a real project on disk, removed after the test → `tempProject` (`src/project/project.test-kit.ts`)
- talk LSP to a language server in memory (open, change, close documents; await published diagnostics; read highlighting decoded) → `connectedClient`, `TestClient` (`src/editor/lsp/server.test-kit.ts`)
- run a property over every corpus and std module open in one language server → `corpusClient`, `corpusDocuments` (`src/editor/lsp/corpus-client.test-kit.ts`)
- state the diagnostics a language server must publish, as `ista check` reports them → `checked`, `projectProgram`, `uriOf` (`src/editor/lsp/diagnostics.test-kit.ts`)
- read a signature help answer's active signature and parameter → `activeOf` (`src/editor/lsp/providers/signature-help.test-kit.ts`)
- ask a language server for definitions or references by position, against the corpus project loaded apart → `definitionsAt`, `referencesAt`, `namesOf`, `positionOf` (`src/editor/lsp/providers/navigation/navigation.test-kit.ts`)
- write a navigation test over in-memory modules, finding names as written and applying rename edits → `navigable`, `placeOf`, `edited` (`src/editor/language-service/navigation/navigation.test-kit.ts`)
- parse a few lines as a module for a language-service feature's test, or check them beside the std modules with a cursor marked `‸` → `treeOf`, `programAt` (`src/editor/language-service/language-service.test-kit.ts`)
- probe many edits of one program, each made and checked after it as an editor does, so only the edit is checked → `editedMainProgram` (`src/editor/language-service/language-service.test-kit.ts`)
- state what a language server must answer over the corpus, from the corpus project loaded apart, and its open documents there → `corpusProgram`, `programDocuments`, `ProgramDocument` (`src/editor/lsp/corpus-client.test-kit.ts`)
- tell whether a resolved name was looked up in scope (not a qualified tail, a declaring name, an ADL callee or an own call) → `isLookedUp` (`src/compiler/binder/bind.test-kit.ts`)
- build an in-memory `Program` or `ModuleLoader`, or list the modules a test owns (all but std) → `programOf`, `memoryLoader`, `idOf`, `moduleAt`, `ownModules`, `loadedPaths` (`src/compiler/program/program.test-kit.ts`)
- edit a module's text as an editor does (random edit sequences, or one name renamed inside one function's body), over the corpus and std test modules → `editSequences`, `applied`, `editInsideBody`, `bodyEditChoices`, `editedTexts`, `stdTests` (`src/compiler/parser/edits.test-kit.ts`)
- build a `Program` with the prelude or all std modules (cached) → `preludeProgramOf`, `stdProgramOf`, `boundReport` (`src/compiler/binder/bind.test-kit.ts`)
- inspect bound entities by name occurrence in source order → `namesIn`, `entityOfName`, `declaringName` (`src/compiler/binder/bind.test-kit.ts`)
- sweep every name the binder resolved over the corpus and std modules → `boundCorpus`, `resolvedNames` (`src/compiler/binder/bind.test-kit.ts`)
- check a `main.ista` snippet with all std modules, or any module of several such as a test module (`reportedAt`), or wrap statements in a function → `reported`, `reportedAt`, `inFunction`; a checker apart from `checkProgram`'s, and its diagnostics by module → `checkedApart`, `diagnosticsOf` (`src/compiler/checker/check.test-kit.ts`)
- check revision after revision of an edited program, each checker from the one before, beside checkers made afresh → `revisionsOf`, `checkedRevision`, `answeredBothWays`, `bodiesChecked`, `answered` (`src/compiler/checker/revisions.test-kit.ts`)
- check many small `stdProgramOf` programs, each checker taking over the std modules' results checked once per file → `checkedAfterStd` (`src/compiler/compile.test-kit.ts`)
- ask a checked `main.ista` by names as written, ask every query a tool may ask of a node, or compare two checkers' answers at every node of a module → `checkedMain`, `answersAt`, `spelledAnswers` (`src/compiler/checker/lookup/lookup.test-kit.ts`)
- check a rule across every std module at once → `everyStdModule` (`src/stdlib/std-modules.test-kit.ts`)
- compile in-memory sources to a `Definition` or its text (the text checked after the std modules, once per file) → `compiledDefinition`, `compiledEncoded`, `diagnosedAt`; the timeout of a test compiling whole programs case after case → `wholeProgramTimeout` (`src/compiler/compile.test-kit.ts`)
- create a test `Runtime` (host/index.ts) with manual clock, recording store and fixed seed → `testRuntime`, `recordingStore`, `testSeed` (`src/runtime/runtime.test-kit.ts`), `ManualClock` (`src/runtime/clock.ts`)
- list every std extern function under the key lowering gives it → `stdExterns` (`src/stdlib/std-externs.test-kit.ts`)
- start a program's live `main` to its end and read how it ended, its outcome as JSON text → `startToEnd` (`src/runtime/runtime.test-kit.ts`)
- compile and run `main()` for a body of one line or several, written unindented, beside declarations → `mainGives`; for a body as written under `_main`'s head → `mainOutcome` (`src/stdlib/prelude/prelude.test-kit.ts`)
- probe written types in a black-box test: resolve them, compare identity, keys and assignability, spell one, list a snippet's codes, run one with its declarations as lines, hover or complete at `‸` → `resolveWrittenTypes`, `compareWrittenTypes`, `spelledTypeOf`, `codesOf`, `runMain`, `definitionOf`, `hoverCodeAt`, `completionNamesAt` (`test/written-types.test-kit.ts`)
- compile and run an `.ista` test module in memory on a manual clock → `reportsOf`, `outcomesOf`, `testModule` (`src/runtime/testing/testing.test-kit.ts`)
- run the `ista` CLI in-process without spawning a child process → `runCli` (`src/cli/cli.ts`), `exitCodes`, `CliEnvironment` (`src/cli/command.ts`); with a test's environment → `ista` (`src/cli/cli.test-kit.ts`)
- generate random token/fragment soup or randomly mutated valid programs → `soupOf` (`test/soup.ts`), `brokenText` (`test/broken.ts`)
- generate random `Value`s or deeply nested values → `valueArbitrary`, `nested` (`src/definition/values/values.test-kit.ts`)
- check what a program, suite or host scenario shows when run against what was recorded before the IR-first rewrite, or add a subject or scenario → the goldens (`test/golden/golden.md`; `subjects.ts`, `scenarios/`, `pipeline/` the one seam a pipeline replaces)
- run a long sweep in slices side by side, its items dealt round `<sweep>-<n>.sweep.test.ts` files → `sliceOf` (`test/slices.ts`)
- check something of every compiled corpus program, example and demo, compiling each once → a row of the corpus sweep (`test/sweep/checks.ts`; what a row reads of a subject, derived once: `compiledOf`, `writtenOf`, `observedOf` in `test/sweep/swept.ts`)
- a Definition without where its code stands (spans, line starts), to compare two layouts of one program → `withoutPlaces` (`src/definition/definition.test-kit.ts`); a program's diagnostics positions aside → `diagnosticsWithoutPlaces` (`src/compiler/compile.test-kit.ts`)
- a Definition's verified code with a dropped let-go or a dropped or doubled hold, which the verifier must refuse → `brokenMutants` (`src/definition/validation/ownership.test-kit.ts`)
- read what a run shows as a pipeline-independent observation (ending, log lines, host-call lines) → `Observation`, `logLine`, `hostCallLine`, `panicEnding` (`test/golden/observation.ts`)
- time a Definition as `ista build` builds it → `builtProgram` (`src/live/built-program.test-kit.ts`)
- generate canonical JSON values or non-canonical JSON texts → `exactJson`, `reverseKeys`, `looseText` (`src/definition/formats/codec.test-kit.ts`)
- a compiled Definition's text edited into one a compiler never writes, a code entry's mode changed → `withModeChanged` (`src/definition/definition.test-kit.ts`)
- generate programs of writes through arrays, maps, structs, closures and `&` paths, each with what value semantics says it gives → `caseSteps`, `aliasingProgram` (`src/runtime/run/aliasing.test-kit.ts`)
- read fenced code examples from `docs/spec.md` and `docs/guide.md`, or from a document's text in hand with where each code line stands → `specExamples`, `specCode`, `isPlaceholder`, `extractExamples`, `documentPaths` (`test/corpus/spec-examples.ts`)
- load `test/corpus/` valid/invalid programs → `runPrograms`, `invalidPrograms`, `corpusDirectory` (`test/corpus/programs.ts`)
- use the M2.4 subset program and its outcome → `subsetSource`, `subsetOutcome` (`test/subset.ts`)

## One-way rules

- Test helpers in `*.test-kit.ts` return observations (such as `Reported` or `Ended`) and never call `expect(...)` themselves, so assertions stay in the test.
- Tests needing std modules use `stdProgramOf` (`src/compiler/binder/bind.test-kit.ts`), which parses the std modules once per test file and reuses their trees.
- Never copy spec example code into a test file; extract it by section heading with `specCode` / `specExamples` (`test/corpus/spec-examples.ts`).
