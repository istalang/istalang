/**
 * What a value of a type has, by name, as a module sees it: its fields and variants as its layout
 * has them, a tuple's elements as fields named by position (`t.0`, §4.5), or the fields its
 * constraints require; the static functions a call through it may choose, its methods, its
 * getters, and its keyed indexes' keys, read as fields are (§5.2, §10.2).
 *
 * Methods and getters are what a member's name means through a value of the type
 * (resolution/choosing/member-meaning.ts), the one answer a read and a call give, each kept where
 * its `self` takes the value with its constraints met; statics are what a static call may choose
 * (resolution/choosing/candidates.ts). The call's other arguments are aside, since completing a
 * call needn't know them yet.
 *
 * Read through a member access, a method taking `&self` counts only where the access is a place,
 * as for a call (resolution/choosing/candidates.ts `callableThrough`).
 *
 * The error type has no members: what a value of it is isn't known, and a call on it resolves to
 * nothing, so offering any member would mislead.
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type { MemberAccess } from '../../syntax/expressions/index.ts';
import type { CheckerContext } from '../contexts/context.ts';
import {
  type Candidate,
  callableThrough,
  staticCandidatesThrough,
} from '../resolution/choosing/candidates.ts';
import { keyedReadType, keyNamesOf } from '../resolution/choosing/keyed-indexes.ts';
import { everyMember } from '../resolution/choosing/member-meaning.ts';
import { selfInference } from '../resolution/choosing/receivers.ts';
import type { ReadMember, TypeMembers } from '../surface/denotation.ts';
import { substitute } from '../types/parts/substitution.ts';
import { requiredFields } from '../types/traits/constraints.ts';
import {
  associatedDeclarationsOn,
  knownConstraints,
  structConstraintsOn,
} from '../types/traits/known-constraints.ts';
import { fieldOf } from '../types/traits/known-fields.ts';
import type { FieldMember, Type } from '../types/type/index.ts';
import { tupleElements } from '../types/type/primitives.ts';

const noMembers: TypeMembers = {
  fields: [],
  variants: [],
  methods: [],
  getters: [],
  keys: [],
  statics: [],
  associatedTypes: [],
};

export function membersOf(
  checker: CheckerContext,
  module: ModuleId,
  type: Type,
  access: MemberAccess | undefined,
): TypeMembers {
  if (type.kind === 'error') {
    return noMembers;
  }
  const { methods, getters, keyed } = everyMember(checker, module, type);
  const callable = (candidates: readonly Candidate[]) =>
    access === undefined ? candidates : callableThrough(checker, access, candidates);
  return {
    fields: fieldsOf(checker, type),
    variants: (type.kind === 'nominal' ? checker.variantsOf(type) : undefined) ?? [],
    methods: declarationsOf(callable(methods.met)),
    getters: gettersOf(checker, type, callable(getters.met)),
    keys: keyed.flatMap((each) =>
      keyNamesOf(each).map((name) => ({
        name,
        declaration: each.candidate.declaration,
        type: keyedReadType(checker, each, name),
      })),
    ),
    statics: staticsOf(checker, module, type),
    associatedTypes: associatedDeclarationsOn(checker, type),
  };
}

/**
 * A struct's fields, a tuple's elements, or what the constraints on `type` require or its struct
 * constraints name, as read.
 */
function fieldsOf(checker: CheckerContext, type: Type): readonly FieldMember[] {
  const elements = tupleElements(type);
  if (elements !== undefined) {
    return elements.map((element, index) => ({ name: String(index), type: element }));
  }
  const names = [
    ...knownConstraints(checker, type).flatMap(({ trait }) =>
      requiredFields(trait).map(({ name }) => name.text),
    ),
    ...structConstraintsOn(checker, type).flatMap((model) =>
      model.named.map((entry) => entry.name),
    ),
  ];
  const constrained = names.flatMap((name) => fieldOf(checker, type, name)?.member ?? []);
  return (
    checker.fieldsOf(type) ?? [...new Map(constrained.map((each) => [each.name, each])).values()]
  );
}

/** The static functions a call through `type` may choose, seen from `module`. */
function staticsOf(
  checker: CheckerContext,
  module: ModuleId,
  type: Type,
): readonly FunctionDeclaration[] {
  return declarationsOf(staticCandidatesThrough(checker, module, type));
}

/** Each getter of `candidates` once, giving what its call on a value of `type` gives. */
function gettersOf(
  checker: CheckerContext,
  type: Type,
  candidates: readonly Candidate[],
): readonly ReadMember[] {
  const byDeclaration = new Map(candidates.map((each) => [each.declaration, each]));
  return [...byDeclaration.values()].map((candidate) => {
    const result = checker.resultOf(candidate.declaration);
    const taken = selfInference(checker, candidate, type);
    const read =
      taken === undefined
        ? result
        : substitute(result, taken.inference.substitution(), checker.typeRules);
    return {
      name: candidate.declaration.name.text,
      declaration: candidate.declaration,
      type: read,
    };
  });
}

/** The functions of `candidates`, each once. */
function declarationsOf(candidates: readonly Candidate[]): readonly FunctionDeclaration[] {
  return [...new Set(candidates.map(({ declaration }) => declaration))];
}
