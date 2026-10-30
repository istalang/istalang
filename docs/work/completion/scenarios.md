---
description: Scenario catalogue for editor completion in ista lsp and the VS Code client, with how it is organised, the fixture, the sources the expectations rest on, the pass/fail counts at the End re-probe and the scenarios still unmet; read before changing or testing completion
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-10-30
tags: [plan, completion, lsp, vscode]
---

# Completion scenarios

What an editor should offer at every position the grammar has, how a list opens and stays open, and what accepting an item inserts. Written from `docs/spec.md` and from what TypeScript, rust-analyzer, Kotlin and Swift do in the analogous place, not from the code. **266 scenarios, 2 failing** after the End fixes (re-probed 2026-10-30); written at 260 and 158 failing, approved by the human before the tests. One test per scenario, the unmet ones pinned with `it.fails`.

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
- An item ranks by relevance bucket (locals, module, imports, prelude, keywords), and at an expected type, matching items come first; the best is preselected only when it is a local or the module's own (or a member, a field, an argument), never a prelude or imported name. An enum's variants rank in the order it declares them (`Ok` before `Err`, `Some` before `None`).
- A bare enum variant is offered only where an enum type is expected (spec §3.11); elsewhere the enum name is.

## Summary

| Group | Name | Scenarios | Pass | Fail | File |
| --- | --- | ---: | ---: | ---: | --- |
| TL | Top level | 8 | 8 | 0 | declarations.md |
| DH | Declaration headers | 7 | 7 | 0 | declarations.md |
| TY | Type positions | 18 | 18 | 0 | declarations.md |
| SD | Struct, enum, trait and alias bodies | 8 | 8 | 0 | declarations.md |
| IM | Imports | 9 | 9 | 0 | declarations.md |
| AN | Annotations | 6 | 6 | 0 | declarations.md |
| ST | Statements | 17 | 17 | 0 | statements.md |
| EX | Expressions | 8 | 7 | 1 | statements.md |
| SC | Scope | 29 | 29 | 0 | statements.md |
| CO | Collections, lambdas, templates | 11 | 10 | 1 | statements.md |
| CF | Control flow | 7 | 7 | 0 | statements.md |
| PA | Patterns | 16 | 16 | 0 | statements.md |
| ET | Expected type | 13 | 13 | 0 | values.md |
| LI | Struct and variant literals | 27 | 27 | 0 | values.md |
| ME | Members | 21 | 21 | 0 | values.md |
| CA | Calls | 13 | 13 | 0 | values.md |
| NO | Where nothing is offered | 8 | 8 | 0 | mechanics.md |
| TR | Opening and staying open | 14 | 14 | 0 | mechanics.md |
| OR | Item shape, order, kinds | 8 | 8 | 0 | mechanics.md |
| RB | Resilience | 15 | 15 | 0 | mechanics.md |
| VC | VS Code client | 3 | 3 | 0 | mechanics.md |
| | **Total** | **266** | **264** | **2** | |

| Priority | Scenarios | Pass | Fail |
| --- | ---: | ---: | ---: |
| P1 | 147 | 147 | 0 |
| P2 | 81 | 79 | 2 |
| P3 | 38 | 38 | 0 |

## Unmet

- **CO-02, EX-04** (filed as F14): an array spread's operand and an `await`'s operand are not ranked by the type they take (`xs` ranks 12th, `fetch` 18th).

Every other scenario is met; tracker F12 and F13 close with PA and VC.

## Not probed

Std-module documents (`std:` scheme), multi-root workspaces, the real VS Code widget (its behaviour is taken from the documented mechanics, not run), completion inside `*.test.ista` (`testing` imports), and documents over the edit-latency budget.
