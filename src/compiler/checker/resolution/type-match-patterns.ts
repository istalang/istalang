/**
 * Whether a type `match` case's pattern matches a type (§3.17), and what its `infer` variables bind.
 *
 * - Matching is exact: the pattern's form and the type's are one, part by part, after aliases
 *   resolve, with no conversion into a union and no one-element tuple. The one exception: a
 *   literal type matched whole, as the subject or the member a union distributes, matches a
 *   pattern naming its base type when it doesn't match exactly. Inside another type it is a part
 *   of a different type: `Box<"a">` is no `Box<String>`.
 * - A variable binds the part standing where it is written; standing again, it must be that part.
 *   One standing beside other members of a union pattern (`infer T | None`) binds what the type's
 *   union has beyond them.
 * - A type not known yet (a type parameter, or a type computed from one) decides nothing: whatever
 *   it becomes might match, so a pattern meeting one is undecided, unless the pattern is that very
 *   type or a variable taking it whole. A part known to differ fails the case whatever the rest
 *   becomes, which is what lets a generic body skip a case (§3.5).
 * - A variable's constraints, and a struct constraint, are judged as conformance judges them,
 *   reporting nothing: not meeting one fails the case, which is no error.
 */

import type { TypeParameter } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { constraintOn } from '../traits/constraints.ts';
import { isStructType } from '../traits/struct-keys.ts';
import { isOpaque } from '../types/computed-types.ts';
import { sameType } from '../types/identity.ts';
import type { StructConstraintModel } from '../types/struct-constraint.ts';
import type { Type } from '../types/type.ts';
import type { CasePatternForm, InferVariable } from '../types/type-match.ts';
import { isKnown, parametersIn, typeChildren, unaliased } from '../types/type-parts.ts';
import { baseOf, membersOf, unionOf } from '../types/unions.ts';
import { searchSite } from '../use-site.ts';
import { silentMeets } from './conformance.ts';
import { type Meets, structShortfall } from './shortfalls.ts';

/** What matching found: a match, none whatever is substituted, or none decided yet (the banner). */
export type Outcome = 'match' | 'fail' | 'undecided';

/** A case's variables, and what they have bound so far. */
interface Matching {
  readonly checker: CheckerContext;
  readonly variables: ReadonlyMap<TypeParameter, InferVariable>;
  readonly bound: Map<TypeParameter, Type>;
  readonly meets: Meets;
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
      return matchStruct(matching, pattern.constraint, unaliased(type));
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
  const before = new Map(matching.bound);
  const outcome = matchType(matching, pattern, type);
  if (outcome !== 'fail' || type.kind !== 'literal') {
    return outcome;
  }
  matching.bound.clear();
  for (const [variable, bound] of before) {
    matching.bound.set(variable, bound);
  }
  return matchType(matching, pattern, baseOf(type));
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
  if (pattern.kind === 'union') {
    return matchUnion(matching, pattern.members, type);
  }
  if (pattern.kind !== type.kind) {
    return 'fail';
  }
  return matchParts(matching, pattern, type);
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
 * A union pattern: matched whole, or, with one variable standing as a member beside others
 * (`infer T | None`), the variable binding what `type`'s members are beyond those others.
 */
function matchUnion(matching: Matching, members: readonly Type[], type: Type): Outcome {
  const [variable, ...more] = members.filter((member) => mentionsVariable(matching, member));
  if (variable === undefined) {
    return sameOrFails(unionOf(members, matching.checker.typeRules), type);
  }
  if (more.length > 0 || variable.kind !== 'parameter') {
    return 'undecided';
  }
  const fixed = members.filter((member) => member !== variable);
  const given = membersOf(type);
  if (!fixed.every((member) => given.some((each) => sameType(each, member)))) {
    return 'fail';
  }
  const rest = given.filter((each) => !fixed.some((member) => sameType(each, member)));
  return rest.length === 0
    ? 'fail'
    : matchType(matching, variable, unionOf(rest, matching.checker.typeRules));
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
    return 'fail';
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
