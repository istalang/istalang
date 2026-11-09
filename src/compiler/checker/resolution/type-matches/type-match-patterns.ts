/**
 * Whether a type `match` case's pattern matches a type (§3.17), and what its `infer` variables
 * bind.
 *
 * - Matching is exact: the pattern's form and the type's are one, part by part, after aliases
 *   resolve, with no conversion into a union and no one-element tuple. The one exception: a
 *   literal type matched whole, as the subject or the member a union distributes, matches a
 *   pattern naming its base type when it doesn't match exactly. Inside another type it is a part
 *   of a different type: `Box<"a">` is no `Box<String>`.
 * - A variable binds the part standing where it is written; standing again, it must be that part.
 * - A union pattern's members holding no variable are each among the type's members. Each member
 *   holding variables, but no variable standing whole, takes the first of the others it matches
 *   (`List<infer T>?`, or the members `Tree<infer T>` unfolds to); one variable standing whole
 *   (`infer T | None`) binds what is left, which must be something. Two standing whole can't split
 *   what is left: undecided while the type isn't known, a failed case once it is.
 * - A known type never leaves a case undecided: it matches or fails, so a type `match` given one
 *   always reduces. A variable an undecided pattern bound nothing to is undecided too.
 * - A type not known yet (a type parameter, or a type computed from one) decides nothing: whatever
 *   it becomes might match, so a pattern meeting one is undecided, unless the pattern is that very
 *   type or a variable taking it whole. A part known to differ fails the case whatever the rest
 *   becomes, which is what lets a generic body skip a case (§3.5).
 * - A variable's constraints, and a struct constraint, are judged as conformance judges them,
 *   reporting nothing: not meeting one fails the case, which is no error.
 * - A recursive type is matched as what it unfolds to (§3.17), on either side; a pair of types met
 *   again while it is matched holds, as two unfoldings equal so far stay equal, so matching ends.
 */

import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { searchSite } from '../../contexts/use-site.ts';
import { sameType } from '../../types/identity/identity.ts';
import { UnfoldingPairs } from '../../types/identity/unfolding-pairs.ts';
import { constraintOn } from '../../types/parts/substitution.ts';
import { typeChildren } from '../../types/parts/type-children.ts';
import { isKnown, parametersIn, unaliased } from '../../types/parts/type-parts.ts';
import { isStructType } from '../../types/traits/struct-keys.ts';
import { isOpaque, unfolded } from '../../types/type/computed-types.ts';
import type { Type } from '../../types/type/index.ts';
import type { StructConstraintModel } from '../../types/type/struct-constraint.ts';
import { baseOf } from '../../types/unions/union-members.ts';
import { membersOf, unionOf } from '../../types/unions/unions.ts';
import type { CasePatternForm, InferVariable } from '../../types/written/type-match.ts';
import { silentMeets } from '../conformance/conformance.ts';
import { type Meets, structShortfall } from '../conformance/shortfalls.ts';

/** What matching found: a match, none whatever is substituted, or none decided yet (the banner). */
export type Outcome = 'match' | 'fail' | 'undecided';

/** A case's variables, and what they have bound so far. */
interface Matching {
  readonly checker: CheckerContext;
  readonly variables: ReadonlyMap<TypeParameter, InferVariable>;
  readonly bound: Map<TypeParameter, Type>;
  readonly meets: Meets;
  /** The pairs of types holding recursion being matched, which hold when met again. */
  readonly unfolding: UnfoldingPairs;
}

/**
 * Whether `pattern`, a case's, matches `type`, and what each of the case's `variables` binds, in
 * `bound`: every one, when it matches.
 */
export function matchCase(
  checker: CheckerContext,
  pattern: CasePatternForm,
  variables: readonly InferVariable[],
  type: Type,
): { readonly outcome: Outcome; readonly bound: ReadonlyMap<TypeParameter, Type> } {
  const matching: Matching = {
    checker,
    variables: new Map(variables.map((variable) => [variable.parameter, variable])),
    bound: new Map(),
    meets: silentMeets(searchSite(checker)),
    unfolding: new UnfoldingPairs(),
  };
  const outcome = all([
    () => matchPattern(matching, pattern, type),
    ...variables.map(
      (variable) => () => variableMeets(matching, variable, matching.bound.get(variable.parameter)),
    ),
  ]);
  return { outcome, bound: matching.bound };
}

function matchPattern(matching: Matching, pattern: CasePatternForm, type: Type): Outcome {
  switch (pattern.kind) {
    case 'any':
      return 'match';
    case 'type':
      return matchWhole(matching, unaliased(pattern.type), unaliased(type));
    case 'struct':
      return matchStruct(matching, pattern.constraint, unfolded(unaliased(type)));
    default: {
      const unhandled: never = pattern;
      return unhandled;
    }
  }
}

/**
 * Whether `pattern` matches `type`, the type matched whole: a literal by its base too, once it
 * fails exactly, what the failed try bound undone (the banner).
 */
function matchWhole(matching: Matching, pattern: Type, type: Type): Outcome {
  const outcome = tried(matching, () => matchType(matching, pattern, type));
  if (outcome !== 'fail' || type.kind !== 'literal') {
    return outcome;
  }
  return matchType(matching, pattern, baseOf(type));
}

/** What `attempt` gives, what it bound undone unless it matched: a failed try binds nothing. */
function tried(matching: Matching, attempt: () => Outcome): Outcome {
  const before = new Map(matching.bound);
  const outcome = attempt();
  if (outcome !== 'match') {
    matching.bound.clear();
    for (const [variable, bound] of before) {
      matching.bound.set(variable, bound);
    }
  }
  return outcome;
}

/** Whether the type `pattern` matches `type`, both written through no alias (the banner). */
function matchType(matching: Matching, pattern: Type, type: Type): Outcome {
  if (type.kind === 'error' || pattern.kind === 'error') {
    return 'match';
  }
  if (
    pattern.kind === 'parameter' &&
    matching.variables.has(pattern.declaration as TypeParameter)
  ) {
    return bindVariable(matching, pattern.declaration as TypeParameter, type);
  }
  if (isOpaque(type) || isOpaque(pattern)) {
    return sameType(pattern, type) ? 'match' : 'undecided';
  }
  if (type.kind === 'recursive' || pattern.kind === 'recursive') {
    return matchUnfolded(matching, pattern, type);
  }
  if (pattern.kind === 'union') {
    return matchUnion(matching, pattern.members, type);
  }
  if (pattern.kind !== type.kind) {
    return 'fail';
  }
  return matchParts(matching, pattern, type);
}

/** Whether `pattern` matches `type`, one of them recursive, as they unfold (the banner). */
function matchUnfolded(matching: Matching, pattern: Type, type: Type): Outcome {
  return matching.unfolding.relate(pattern, type, 'match', (unfoldedPattern, unfoldedType) =>
    matchType(matching, unfoldedPattern, unfoldedType),
  );
}

/** Whether two types of one kind, neither a union, match part by part. */
function matchParts(matching: Matching, pattern: Type, type: Type): Outcome {
  const parts = (one: readonly Type[], other: readonly Type[]): Outcome =>
    one.length === other.length
      ? all(one.map((each, index) => () => matchType(matching, each, other[index] ?? each)))
      : 'fail';
  switch (pattern.kind) {
    case 'nominal':
      return type.kind === 'nominal' && pattern.entity === type.entity
        ? parts(pattern.arguments, type.arguments)
        : 'fail';
    case 'anonymous':
      return type.kind === 'anonymous' &&
        pattern.fields.map(({ name }) => name).join() === type.fields.map(({ name }) => name).join()
        ? parts(typeChildren(pattern), typeChildren(type))
        : 'fail';
    case 'function':
      return type.kind === 'function' &&
        pattern.isAsync === type.isAsync &&
        pattern.isSendable === type.isSendable &&
        pattern.parameters.map((each) => each.reference).join() ===
          type.parameters.map((each) => each.reference).join() &&
        (pattern.pack === undefined) === (type.pack === undefined)
        ? parts(typeChildren(pattern), typeChildren(type))
        : 'fail';
    case 'tuple':
      return parts(typeChildren(pattern), typeChildren(type));
    case 'any':
      return type.kind === 'any' &&
        pattern.constraints.length === type.constraints.length &&
        pattern.constraints.every(({ trait }, index) => type.constraints[index]?.trait === trait)
        ? parts(typeChildren(pattern), typeChildren(type))
        : sameOrFails(pattern, type);
    default:
      return sameOrFails(pattern, type);
  }
}

/** A match where two types are one; else no match, the types being known. */
function sameOrFails(pattern: Type, type: Type): Outcome {
  return sameType(pattern, type) ? 'match' : 'fail';
}

/**
 * A union pattern (the banner): its members each among `type`'s, the variables' taking the rest.
 */
function matchUnion(matching: Matching, members: readonly Type[], type: Type): Outcome {
  const { typeRules } = matching.checker;
  const binding = members.filter((member) => mentionsVariable(matching, member));
  if (binding.length === 0) {
    return sameOrFails(unionOf(members, typeRules), type);
  }
  const given = membersOf(type);
  const fixed = members.filter((member) => !binding.includes(member));
  if (!fixed.every((member) => given.some((each) => sameType(each, member)))) {
    return 'fail';
  }
  let rest = given.filter((each) => !fixed.some((member) => sameType(each, member)));
  const whole = binding.filter((member) => isVariable(matching, member));
  for (const member of binding.filter((each) => !whole.includes(each))) {
    const taken = firstMatched(matching, member, rest);
    if (taken.index === undefined) {
      return taken.outcome;
    }
    rest = rest.filter((_, index) => index !== taken.index);
  }
  const [variable, ...others] = whole;
  if (variable === undefined) {
    return rest.length === 0 ? 'match' : 'fail';
  }
  if (others.length > 0) {
    return isKnown(type) ? 'fail' : 'undecided';
  }
  return rest.length === 0 ? 'fail' : matchType(matching, variable, unionOf(rest, typeRules));
}

/**
 * The first of `candidates` `pattern` matches, what it bound kept; else whether one might once
 * its types are known.
 */
function firstMatched(
  matching: Matching,
  pattern: Type,
  candidates: readonly Type[],
): { readonly outcome: Outcome; readonly index?: number } {
  let outcome: Outcome = 'fail';
  for (const [index, candidate] of candidates.entries()) {
    const each = tried(matching, () => matchType(matching, pattern, candidate));
    if (each === 'match') {
      return { outcome: each, index };
    }
    if (each === 'undecided') {
      outcome = each;
    }
  }
  return { outcome };
}

/** Whether `type` is a variable of the case, standing whole. */
function isVariable(matching: Matching, type: Type): boolean {
  return type.kind === 'parameter' && matching.variables.has(type.declaration as TypeParameter);
}

/** A variable taking `type` whole, or, standing again, finding the part it bound there. */
function bindVariable(matching: Matching, variable: TypeParameter, type: Type): Outcome {
  const bound = matching.bound.get(variable);
  if (bound === undefined) {
    matching.bound.set(variable, type);
    return 'match';
  }
  if (sameType(bound, type)) {
    return 'match';
  }
  return isKnown(bound) && isKnown(type) ? 'fail' : 'undecided';
}

/**
 * `case struct …:` (§3.17): a struct type meeting the constraint, its entries' variables binding
 * the fields' types; a type not known yet matches when its own constraints imply it.
 */
function matchStruct(matching: Matching, constraint: StructConstraintModel, type: Type): Outcome {
  const { checker } = matching;
  const binding = constraint.named.filter(({ rule }) => ruleMentionsVariable(matching, rule));
  const plain: StructConstraintModel = {
    named: constraint.named.filter((entry) => !binding.includes(entry)),
    others:
      constraint.others !== undefined && ruleMentionsVariable(matching, constraint.others)
        ? undefined
        : constraint.others,
  };
  if (isOpaque(type)) {
    const free = binding.length === 0 && plain.others === constraint.others;
    return free && structShortfall(checker, type, plain, matching.meets) === undefined
      ? 'match'
      : 'undecided';
  }
  if (!isStructType(type) || structShortfall(checker, type, plain, matching.meets) !== undefined) {
    return 'fail';
  }
  const fields = checker.fieldsOf(type) ?? [];
  const named = new Set(constraint.named.map(({ name }) => name));
  const fieldType = (name: string) => fields.find((field) => field.name === name)?.type;
  const { others } = constraint;
  const bindsOthers = others !== undefined && plain.others === undefined;
  return all([
    ...binding.map((entry) => () => {
      const found = fieldType(entry.name);
      return found === undefined || entry.rule.kind !== 'type'
        ? 'fail'
        : matchType(matching, unaliased(entry.rule.type), unaliased(found));
    }),
    ...(bindsOthers && others.kind === 'type'
      ? fields
          .filter((field) => !named.has(field.name))
          .map((field) => () => matchType(matching, unaliased(others.type), unaliased(field.type)))
      : []),
  ]);
}

/** Whether a variable, bound to `type`, meets its constraints (§3.17), as a case requires. */
function variableMeets(
  matching: Matching,
  { constraints }: InferVariable,
  type: Type | undefined,
): Outcome {
  if (type === undefined) {
    // Bound nothing: its pattern is undecided, which decides the case.
    return 'undecided';
  }
  const { checker } = matching;
  const traitsMet = constraints.traits.every((trait) =>
    matching.meets(type, constraintOn(trait, type, checker.typeRules)),
  );
  const structsMet = constraints.structs.every(
    (model) => structShortfall(checker, type, model, matching.meets) === undefined,
  );
  if (traitsMet && structsMet) {
    return 'match';
  }
  return isOpaque(type) ? 'undecided' : 'fail';
}

function mentionsVariable(matching: Matching, type: Type): boolean {
  return parametersIn(type).some((each) => matching.variables.has(each as TypeParameter));
}

function ruleMentionsVariable(
  matching: Matching,
  rule: StructConstraintModel['named'][number]['rule'],
): boolean {
  return rule.kind === 'type' && mentionsVariable(matching, rule.type);
}

/** Every outcome, in order, short of the first failure: a match only when each matches. */
function all(outcomes: readonly (() => Outcome)[]): Outcome {
  let result: Outcome = 'match';
  for (const outcome of outcomes) {
    const each = outcome();
    if (each === 'fail') {
      return 'fail';
    }
    if (each === 'undecided') {
      result = 'undecided';
    }
  }
  return result;
}
