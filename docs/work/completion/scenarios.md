---
description: Scenario catalogue for editor completion in ista lsp and the VS Code client, with how it is organised, the fixture, the sources the expectations rest on, today's pass/fail counts and the gaps behind the failures; read before changing or testing completion
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-10-30
tags: [plan, completion, lsp, vscode]
---

# Completion scenarios

What an editor should offer at every position the grammar has, how a list opens and stays open, and what accepting an item inserts. Written from `docs/spec.md` and from what TypeScript, rust-analyzer, Kotlin and Swift do in the analogous place, not from the code. **261 scenarios, 159 failing today.** The human approves it before the tests are written (one test per scenario, the failing ones pinned with `it.fails`).

Files: `declarations.md`, `statements.md`, `values.md`, `mechanics.md`.

**Tests.** `src/lsp/providers/completion-scenarios-*.test.ts`, one test per scenario, named `<ID> <title>` (run one with `vitest -t "TL-01 "`), over the LSP in memory. A scenario still failing is pinned with `it.fails`; when a fix makes it hold, its test fails: drop the `fails` flag from its entry and refresh its status here. The fixture and the checks are in `completion-scenarios.test-kit.ts`; RB-10 to RB-13 and VC-01 to VC-03 are hand-written in `completion-scenarios-protocol.test.ts`.

## How to read a scenario

- **Snippet.** The cursor is `‸`. A snippet marked "in `fn t`" is the body of the fixture function below, indented two spaces, with a statement after it, so the block is not empty (an empty block at the end of the file is RB-01, RB-02). "Top level" ones follow the fixture's declarations. `---` separates variants; every variant must meet the expectation. `⟵ typing "x"` marks the character whose typing asks for the list.
- **Trigger.** "Invoked, or typing on" means a request of kind Invoked (Ctrl+Space, or a letter typed: VS Code's quick suggestions). "Typing `c`" is a request of kind TriggerCharacter with that character, which VS Code sends only if the server declared it.
- **Offer / Not.** The items that must be there and those that must not. "As X" refers to another scenario's list. Whatever is typed so far filters at the client, so lists do not depend on the prefix (TR-08).
- **Accept.** What the item inserts. Absent means the label alone.
- **Order.** Where it matters: VS Code sorts by `sortText`, then by label, then by its own fuzzy score; an item with `preselect` starts selected.
- **Priority.** P1 core (the spec forbids the alternative, or it is what the human reported); P2 what mature servers do and users expect; P3 polish.
- **Today.** Status through the built server: `npm run build`, then `node dist/cli/main.js lsp --stdio`, a raw JSON-RPC client opening the fixture plus the snippet and sending `textDocument/completion` with the stated trigger. Assertions are on labels, insert text (`textEdit.newText`, else `insertText`, else label), `command`, kinds, details, order (`preselect` first, then `sortText`, else label) and the declared trigger characters. A trigger character not declared by the server fails the scenario outright, as VS Code would never send it.

## Fixture

Every snippet is appended to this module (`fixture.ista`); body snippets follow the function header.

```
import * as time from 'time'

struct Pair:
  first: int
  second: int

struct UserId { id: string }

shared struct Lease:
  name: string
  renewals: int = 0

enum Color { Red; Green; Blue }

enum Decision:
  Approved { by: string }
  Rejected { by: string; reason: string }
  Expired

struct Cfg:
  color: Color
  n: int
  note: string?

struct Box<T>:
  value: T
  tag: string

trait Shape:
  fn area(self: Self) -> float

trait Zero:
  fn Self.zero() -> Self

fn plus(a: int, b = 1): a + b
fn paint(c: Color, n: int) -> int: n
fn Pair.make() -> Pair: Pair{first: 1, second: 2}
fn sum(self: Pair) -> int: self.first + self.second
async fn fetch(id: string) -> Future<string>: id
async fn work(n: int) -> Future<int>: n
fn logAll(level: string, ...parts: Array<string>): 1
fn _hidden() -> int: 1
type Id = string
struct Opts { zeta: int; alpha: int = 1 }

fn t(xs: Array<int>, p: Pair, po: Pair?, cfg: Cfg, d: Decision, o: int?, l: Lease, u: UserId, m: Map<string, int>, n: int, col: Color, r: Result<int>) -> int:
```

`async fn t` replaces `fn t` where a scenario says so. `Duration`, `Time`, `delay`, `now` are `time`'s exports.

## Sources

- **spec §n**: `docs/spec.md`; **guide L3**: `docs/guide.md` level 3.
- **LSP**: the 3.17/3.18 completion request: `triggerCharacters`, `CompletionItem` (`insertText`, `insertTextFormat`, `textEdit`, `command`, `sortText`, `filterText`, `preselect`, `commitCharacters`, `labelDetails`, `kind`, `detail`, `documentation`), `isIncomplete`, `completionItem/resolve`, UTF-16 positions.
- **VS Code**: the suggest widget closes when a character that is not part of a word is typed, unless it is a trigger character; `editor.quickSuggestions` opens it on typing letters (off in strings and comments by default); `editor.wordBasedSuggestions` fills in when the server gives nothing; `acceptSuggestionOnCommitCharacter`; items sort by `sortText`.
- **TS / RA / KT / SW**: TypeScript's, rust-analyzer's, Kotlin's (IntelliJ) and Swift's (SourceKit-LSP) completion, cited only where they agree with each other and the spec leaves the editor convention open.

## Where the expectations go beyond the spec

The spec says nothing about editors, so these are decisions the approval covers:
- Which keywords belong at a position follows the grammar: a declaration start offers declaration keywords, a statement start statement keywords, an operand's end infix words only.
- A trigger-opened list equals the invoked one (TR-07), so the server may declare many trigger characters; the position decides whether anything is returned (NO-08).
- Space (` `) is a trigger character, answered only after a literal's `{` or `,`, a call's `,`, or a field/argument's `: `.
- Accepting a field or a named argument inserts `name: ` and asks for the next list.
- An item ranks by relevance bucket (locals, module, imports, prelude, keywords), and at an expected type, matching items come first and the best is preselected.
- A bare enum variant is offered only where an enum type is expected (spec §3.11); elsewhere the enum name is.

## Summary

| Group | Name | Scenarios | Pass | Fail | File |
| --- | --- | ---: | ---: | ---: | --- |
| TL | Top level | 8 | 1 | 7 | declarations.md |
| DH | Declaration headers | 7 | 1 | 6 | declarations.md |
| TY | Type positions | 17 | 3 | 14 | declarations.md |
| SD | Struct, enum, trait and alias bodies | 7 | 0 | 7 | declarations.md |
| IM | Imports | 9 | 1 | 8 | declarations.md |
| AN | Annotations | 5 | 0 | 5 | declarations.md |
| ST | Statements | 17 | 3 | 14 | statements.md |
| EX | Expressions | 7 | 2 | 5 | statements.md |
| SC | Scope | 29 | 28 | 1 | statements.md |
| CO | Collections, lambdas, templates | 11 | 0 | 11 | statements.md |
| CF | Control flow | 7 | 1 | 6 | statements.md |
| PA | Patterns | 15 | 1 | 14 | statements.md |
| ET | Expected type | 13 | 7 | 6 | values.md |
| LI | Struct and variant literals | 27 | 17 | 10 | values.md |
| ME | Members | 22 | 16 | 6 | values.md |
| CA | Calls | 13 | 0 | 13 | values.md |
| NO | Where nothing is offered | 8 | 2 | 6 | mechanics.md |
| TR | Opening and staying open | 14 | 8 | 6 | mechanics.md |
| OR | Item shape, order, kinds | 7 | 2 | 5 | mechanics.md |
| RB | Resilience | 15 | 9 | 6 | mechanics.md |
| VC | VS Code client | 3 | 0 | 3 | mechanics.md |
| | **Total** | **261** | **102** | **159** | |

| Priority | Scenarios | Pass | Fail |
| --- | ---: | ---: | ---: |
| P1 | 146 | 64 | 82 |
| P2 | 80 | 27 | 53 |
| P3 | 35 | 11 | 24 |

## Gaps behind the failures

1. **One list for every position.** Outside members and literal fields, completion offers every visible name plus every keyword, whatever the grammar allows there: statement words in expressions, `case`/`in` at a statement start, values in type positions, names where a name is declared, bare enum variants with no expected type.
   Scenarios: TL-01, TL-02, TL-03, TL-04, TL-05, TL-06, TL-08, DH-01, DH-03, DH-04, DH-05, DH-06, DH-07, TY-01, TY-02, TY-02b, TY-03, TY-04, TY-05, TY-06, TY-07, TY-11, TY-12, TY-13, TY-14, TY-15, TY-16, SD-01, SD-02, SD-03, SD-03b, SD-04, SD-05, SD-06, ST-01, ST-03, ST-04, ST-05, ST-07, ST-08, ST-09, ST-10, ST-11, ST-12, ST-13, ST-15, ST-16, ST-17, EX-01, EX-02, EX-03, EX-04, EX-06, NO-01, NO-02, NO-03, NO-07, NO-08, NO-09, CO-01, CO-02, CO-03, CO-04, CO-04b, CO-05, CO-06, CO-06b, CO-07, CO-08, CO-09, CF-01, CF-02, CF-03, CF-04, CF-05, CF-07, PA-09, PA-11, PA-13, ET-11, CA-01, CA-07, CA-10, CA-12, SC-07.
2. **Items carry only a label.** No `insertText`, `command`, `preselect`, `sortText`, `commitCharacters`; a field inserts `first`, not `first: `; kinds collapse types to Class; variables have no detail; every list is alphabetical so the variants of a `Color` field sit far down the list.
   Scenarios: LI-01, LI-01b, LI-02, TR-09, TR-10, TR-11, TR-12, OR-01, OR-03, OR-04, OR-05, OR-06, ET-01, ET-02, ET-04, ET-10, ET-13, EX-04, CO-02, LI-11, ME-01, ME-03.
3. **Triggers the client never sends.** Only `.`, `>`, `{`, `,` are declared. A space after `, ` closes the list (the reported bug); `@`, `'`, `"`, `/` open nothing; a typed space elsewhere would need an empty answer (NO-08).
   Scenarios: LI-03, LI-04, LI-07, CA-03b, CA-05, PA-03b, TR-05, TR-06, NO-08, NO-09, IM-06, IM-07, AN-01, AN-02, AN-03, AN-05.
4. **Expected type is not used.** The spec gives fields, arguments, `return`, annotated declarations and comparisons an expected enum type, yet nothing is ranked or preselected, and bare variants are offered everywhere.
   Scenarios: ET-01, ET-02, ET-04, ET-10, ET-11, ET-13.
5. **Patterns.** A `case` start offers variables and every keyword instead of the scrutinee's variants; pattern fields (`Rejected{‸}`, `Ok{‸}`) offer nothing; no `as`/`is` after a field (tracker F12).
   Scenarios: PA-01, PA-02, PA-03, PA-03b, PA-04, PA-05, PA-06, PA-06b, PA-07, PA-08, PA-09, PA-11, PA-12, PA-13.
6. **Calls offer no argument names.** `plus(‸` has no `a:`/`b:`; the call's `,` trigger returns nothing.
   Scenarios: CA-02, CA-03, CA-04, CA-06, TR-10, RB-04b.
7. **Imports and annotations.** No exports inside `import ‸ from 'm'`, no module specifiers, no annotation names or fields.
   Scenarios: IM-01, IM-02, IM-03, IM-04, IM-04b, IM-05, IM-06, IM-07, AN-01, AN-02, AN-03, AN-04, AN-05.
8. **Scope gaps.** A loop variable is visible in its own iterable (SC-07); a freshly opened block misses its bindings (RB-02b) and an empty function body at the end of the file misses its parameters (RB-01); `hold let` names and local-function placement are checked in SC-13/SC-21.
   Scenarios: SC-07, RB-01, RB-02b.
9. **Member gaps.** A line-leading `.` offers nothing; tuples offer no `0`/`1`; methods insert no `(`; `..`/`...` typed as `.` offer every name; a literal's single-field positional form offers bare names.
   Scenarios: ME-01, ME-11, ME-13, ME-19, LI-12.
10. **Resilience.** A broken sibling declaration can silence a function's members (RB-05); an untitled document gets no completion although the client selects it (RB-13); an empty file offers statement words (RB-07).
   Scenarios: RB-05, RB-07, RB-13.
11. **Client defaults.** `[ista]` leaves word-based suggestions on, quick suggestions unstated, and declares no word pattern.
   Scenarios: VC-01, VC-02, VC-03.

Already filed: tracker F12 (struct patterns, here PA-03, PA-08) and F13 (word-based suggestions, here VC-01).

## Not probed

Std-module documents (`std:` scheme), multi-root workspaces, the real VS Code widget (its behaviour is taken from the documented mechanics, not run), completion inside `*.test.ista` (`testing` imports), and documents over the edit-latency budget.
