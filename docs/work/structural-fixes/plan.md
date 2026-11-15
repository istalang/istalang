---
description: plan for B94 and its structural siblings — type identity from one structural walk, per-field layout and one expansion reach, member meaning answered once, inference asymmetries fixed at their units; process, phases, acceptance, decisions. Read before starting or examining a structural-fixes phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [plan, structural-fixes, b94, cohesion, dry]
---

# Plan: structural fixes

These bugs recur when a concept is derived in several places that must agree, or a relation is applied
one-sidedly, so a change reaches only some of the places. Each phase gives its concept one derivation, or fixes
the asymmetry in the unit that owns it. Evidence: `findings.md`, `research/`.

## Docs

- `implementer-notes.md`: how a phase runs.
- `a.md`, `b.md`, `c.md`, `d.md`: one per phase, each self-contained (traced cause, code map, repros,
  acceptance, tracker rows).
- `type-identity.md`: phase A's contract.
- `findings.md`: the clusters, with corrections.
- `research/`: the scout reports and the plan review, verbatim.
- `status.md`: tech-lead state.

## Process

- Each phase is its own worktree and a fresh `dev` agent in implementer mode, briefed by its phase doc, then a
  cold reviewer and a cold QA. Every phase touches correctness: persisted identity, layouts and expansion,
  diagnostics, or inference.
- **One wave of four** (no shared files): A, B, C, D. The tech-lead ff-merges each once its reviewer approves.
  By the human's call, A ran first, and C and D run as one session on one branch (`sf-cd-members-inference`),
  C then D, with one examination over both.
- **Merge review:** one over all four merged, then `npm run verify` on main.
- **Step 0 (tech-lead, on approval):** tracker hygiene. Delete the stale rows and merge the duplicates in
  `findings.md`, correct B94, file the new A findings under this plan, and add its traced mechanism to B87.
- **E** (`findings.md` §E, plus B87) gets its own plan after this one.

## Phases

**A. Type identity (`a.md`, `type-identity.md`).** The checker's structural walk becomes the only one. With
identities spelled as qualified names, it gives the table key. That key orders and names union variants and
names entries, with no aliases. Extern keys become a frozen projection. Validation rejects duplicate variant
names; a test holds std extern keys distinct. Array and Map are recognized by role. Covers B94, B65, P35, the union-parenthesis
collision and the runtime variant mix-up.
1. Property: distinct `typeKey` ⇒ distinct table key.
2. The repros pass, B92's included.
3. Extern keys and `declaredType` stay byte-identical, except a recursive type no alias names, once spelled by `typeText` and now by its table key (one key: FormBuilder's `validateSupplier` start key).
4. B65: a program's Definition is the same alone as inside a bigger program.
5. Duplicate variant names are rejected by validation, a test holds every std extern declaration's key
   distinct, and no runtime code recognizes a type by name.

**B. Per-field layout, one expansion reach (`b.md`).** A field's type is resolved per field, so a default that
reads a known field closes no declaration-wide cycle. One reach per generic declaration (every field's type,
requirement calls through their requirement, type-entry calls) feeds type expansion, function expansion and data
kinds. Covers B70, B18, B81, B1 and B52.
1. B70 checks.
2. B18, B81, B1 and B52 report 5125 (or their spec'd diagnostic) instead of overflowing.
3. No other diagnostic changes.

**C. Member meaning, answered once (`c.md`).** One unit in `resolution/choosing/` decides what a name on a
receiver can mean. The checker, completion and the members query all use it. The checked body records the
callee's type and the facts the editor reads. Covers B22, B51, Q40, P14 (judged) and B64 (if confirmed).
1. B22 gives 5400 and 5214.
2. Signature help works through a field (B51).
3. `matched-type.ts` no longer restates the pattern walk.
4. Completion's expectations are unchanged except B22/B51.

**D. Inference asymmetries (`d.md`).**
- Call-shaped constructs get the call's standing (B88).
- `sameShape` treats packs symmetrically (B68).
- A return settles after its mark is solved (B69).
- `relate` treats an associated type on either side alike (B91).
- Messages tell apart same-named type parameters.

Acceptance:
1. The four repros check.
2. No other expectations change.

## Decisions (approval)

- **D1:** the table key is the structural walk with qualified names and no aliases. It names union variants
  (identities, validated unique) and entries. `recursive-aliases.ts` goes, and B65 with it. Rejected: readable
  alias labels scoped to the entry's imports, which costs more code for nicer traces.
- **D2:** pre-release, so persisted Definition names change with no migration. Extern keys and `declaredType`
  don't change.
- **D3:** no spec change for default-typed fields. B's per-field layout makes them work, and fields stay
  consistent with parameters, which also take their type from a default (§3.3).
- **D4:** scope is A–D now. E and B87 get a plan after.
