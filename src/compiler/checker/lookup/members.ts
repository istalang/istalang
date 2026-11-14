/**
 * What a value of a type has, by name, as a module sees it: its fields and variants as its layout
 * has them, a tuple's elements as fields named by position (`t.0`, §3.15), or the fields its
 * constraints require; the static functions a call through it may choose, its methods, and its
 * getters, read as fields are (§3.1).
 *
 * Methods and statics are what a call may choose (resolution/choosing/candidates.ts, which lists
 * them by the same sources it chooses from), a method kept where `self` takes a value of the type
 * as a call's receiver (resolution/choosing/applicability.ts), and the type parameters that decides
 * meet their constraints. The call's other arguments are aside, since completing a call needn't
 * know them yet.
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
  receiverCandidates,
  receiverMembers,
  staticCandidatesThrough,
} from '../resolution/choosing/candidates.ts';
import { takesAsSelf } from '../resolution/choosing/receivers.ts';
import { metThroughTraits } from '../resolution/conformance/trait-calls.ts';
import type { TypeMembers } from '../surface/denotation.ts';
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
  const { methods, getters } = receiverMembers(checker, receivedBy(checker, module, type, access));
  return {
    fields: fieldsOf(checker, type),
    variants: (type.kind === 'nominal' ? checker.variantsOf(type) : undefined) ?? [],
    methods: declarationsOf(methods),
    getters: declarationsOf(getters),
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

/**
 * The functions taking a value of `type` as `self` that a member of it may mean, and through
 * `access` if given.
 */
function receivedBy(
  checker: CheckerContext,
  module: ModuleId,
  type: Type,
  access: MemberAccess | undefined,
): readonly Candidate[] {
  const candidates = metThroughTraits(checker, receiverCandidates(checker, module, type));
  const callable = access === undefined ? candidates : callableThrough(checker, access, candidates);
  return callable.filter((candidate) => takesAsSelf(checker, candidate, type));
}

/** The functions of `candidates`, each once. */
function declarationsOf(candidates: readonly Candidate[]): readonly FunctionDeclaration[] {
  return [...new Set(candidates.map(({ declaration }) => declaration))];
}
