# Feature-reduction research (spec level)

Repo: /Users/arash/Projects/istalang. You are a RESEARCH agent: change NO repository file; write only /private/tmp/claude-501/-Users-arash-Projects-istalang/d5ffc111-a5d9-4c10-86d7-e57ade604cf2/scratchpad/dry/spec-features.md.
Read docs/spec.md fully, docs/guide.md, docs/arch/architecture.md, docs/arch/definition.md, docs/arch/boundary.md,
and every non-test std module src/stdlib/**/*.ista (not *.test.ista).

The project's principle: every language feature is built on top of existing features (e.g. Optional = a union with
None; unions are laid out as enums). The lead suspects some features still carry their own machinery although they
could be reduced to (desugared into) another feature, or two features do similar things where one could be reduced
to the other — and that this is why a change now touches many places.

For EVERY language feature/construct in the spec (types, declarations, expressions, statements, patterns, operators,
literals incl. indented values/templates/ranges, field loops, comprehensions, deferred calls, spawn/defer, await/select,
futures/resolvers, slots, shared structs, extern types, context consts, marks/kinds, sendable, disposal/hold/drop/keep,
codecs/JSON, traits/any, type match/recursive aliases, keyof/mapped types, variance, packs, defaults, testing…):
1. one line: what it is;
2. its implementation footprint: grep src/ (non-test .ts) for its node kind / well-known name / helper names and list
   the files+functions special-casing it (count them);
3. whether it is (a) already a desugaring of another feature, (b) could be reduced to another feature (say which, how,
   and what machinery would disappear), or (c) genuinely primitive. Also flag pairs of features that overlap.
4. any std `.ista` function whose job is done instead by a TS native or compiler special-case that could move to .ista.
Then a ranked `## Reduction candidates` section: each with evidence (spec §, file:function list) and the payoff
(how many sites disappear). Be concrete; no speculation without grep evidence.
When done: `hcom send @leve --intent inform -- 'spec done: <path>'`, then stay alive listening for follow-ups.
