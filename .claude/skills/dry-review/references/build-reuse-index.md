# Building the reuse index

Build `docs/reuse/`: the index of what already exists in this codebase for reuse. Documentation only: change no code.

## Why

Most of a project's debt has one root cause: an agent (developer or reviewer) starts a task cold, reads only the code near its change, and doesn't know that the codebase already has a unit for its need, or that a way to solve a recurring problem was already decided. So it writes a second implementation (a DRY violation) or a second way to do the same thing (a double standard). Typical results: a record read by position in one place and by name in another; the same type check written by hand at seven sites; two parallel subsystems each inventing their own shape for one concept; two derivations of one seed; two functions with one name and different contracts.

The index fixes that. An agent about to write code for a need opens the one file that matches it and finds, in seconds, the unit to call and the way already chosen, without reading the codebase. The source tree's `AGENTS.md` (auto-loaded) lists these files and who must read each before coding, so no agent can miss them.

The second constraint matters just as much: the index must not waste an LLM's context. A reader loads one or two files, not all of them, and every line must earn its place. It's an index, not an explanation: how a unit works is the job of its own banner and doc comment.

## What the files hold

- **Grouped by the caller's need**, not by the feature or folder that implements it; a caller often needs units from several features. Name and group the files by what callers want to do. For a compiler, for example: building and reading values from the host language; types (building, comparing, substituting, fitting, converting); calls and overload resolution; diagnostics; syntax trees and traversal; standard library modules and natives; persistence; text and positions; test kits and generators. Decide the grouping from what you find, keep the number of files small (about 8–14), and split or merge them as you learn.
- **Three kinds of entry, nothing else:**
  1. **Units**, one line each: the need in the caller's words (so it can be grepped) → symbol (path), plus one clause on its contract only when the name doesn't say it. Example: read a struct field of a language value from TypeScript → `fieldValueOf` (`src/definition/values/declared-values.ts`).
  2. **One-way rules**: the decided way to handle a recurring problem, with a one-clause reason. Example: "an expected failure returns `Result`; a broken precondition panics." If the architecture doc or spec already holds the rule, point to it in one line instead of restating it.
  3. **Recipes**: 3–6 steps naming the files, for each recurring extension point (e.g. add a module, a node kind, an error code, a persisted field).
- **What qualifies**: an exported unit with callers (or plausible callers) outside its own feature folder, or a rule every new feature must follow. Leave out internals that one module uses, explanations of how something works, file lists, history, and anything that changes with every refactor.
- **Anchor to stable surfaces**: exported symbol plus module path; never line numbers or private names.
- **Format**: each file follows the project's doc conventions (e.g. front-matter), and its description says what need it covers and who must read it before coding. Keep each file under about 150 lines and each line under about 160 characters, as concise as `AGENTS.md`.

## Pointers in `AGENTS.md`

- The `AGENTS.md` (or `CLAUDE.md`) covering the source tree (e.g. `src/AGENTS.md`) gets one short section that stays mostly static, since every agent (developer, reviewer, QA) reads it:
  - what `docs/reuse/` is, in one or two sentences;
  - its files, each with one line saying which callers must read it before coding;
  - the rule: before writing a helper or choosing how to solve a recurring problem, read the matching file; when you add, rename, move or delete a reusable unit or one-way rule, update its line in the same commit.
- If the project has a docs index (e.g. `docs/AGENTS.md`), add `reuse/` to it.
- Never put an index of functions in any `AGENTS.md`: those hold general rules and must stay static.

## How to work

- Read the project's `AGENTS.md` files and its architecture doc first.
- Go through the codebase systematically, folder by folder, lowest layer first (from the architecture doc, otherwise the import graph), splitting large folders into their subfolders; then the shared test kits and helpers. Include public functions in sources outside the main language that other modules reuse (e.g. a standard library written in the project's own language). Keep the folders as a checklist in the audit file and tick each once its entries are written, so an interrupted run can resume.
- For each folder: list its exports (e.g. `rg '^export'`), read the banners and doc comments, and check which exports are imported from outside the folder (`rg`). That tells you what qualifies and what the need is in the callers' words.
- Write as you go: after each folder, add its entries to the matching files and commit them (following the project's commit convention) before moving on. Never leave the writing to the end.
- The code is the truth: list only symbols that exist and are exported now. When you find two homes for one need, list the one callers should use and record the other as a finding in the audit file. Don't fix code.
- At the end, reread every file once: remove duplicates and anything that doesn't earn its line, check that every listed symbol still exists (`rg`), and make the `AGENTS.md` list match the files.
- The project's checks must stay green (they may lint docs too). Ask the human only if you're blocked.
