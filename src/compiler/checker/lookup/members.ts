/**
 * What a value of a type has, by name, as a module sees it: its fields and variants as its layout
 * has them, a tuple's elements as fields named by position (`t.0`, §3.15), or the fields its
 * constraints require; the static functions a call through it may choose, and its methods.
 *
 * A method is found as a method call finds it (resolution/candidates.ts): by each name the module
 * sees at its top level, the type's own module exports, or its constraints require, with that
 * call's candidates kept where `self` takes a value of the type as a call's receiver
 * (resolution/applicability.ts), and the type parameters that decides meet their constraints. The
 * call's other arguments are aside, since completing a call needn't know them yet.
 *
 * Read through a member access, a method taking `&self` counts only where the access is a place,
 * as for a call (resolution/candidates.ts `callableThrough`).
 *
 * The error type has no members: what a value of it is isn't known, and a call on it resolves to
 * nothing, so offering any member would mislead.
 */

import type { ModuleId } from '../../program/program.ts';
import {
  declaredFunctions,
  type FunctionDeclaration,
  isMethod,
  type TypeParameter,
} from '../../syntax/declarations.ts';
import type { MemberAccess } from '../../syntax/expressions/index.ts';
import type { CheckerContext } from '../context.ts';
import type { TypeMembers } from '../denotation.ts';
import type { Inference } from '../inference/infer.ts';
import { takenBy } from '../resolution/applicability.ts';
import { bindArguments } from '../resolution/binding.ts';
import {
  type Candidate,
  callableThrough,
  modulesSeenFrom,
  staticCandidates,
  staticFunctionsAmong,
  staticTargetOf,
  topLevelCandidates,
} from '../resolution/candidates.ts';
import { signatureOf } from '../resolution/choice.ts';
import { meets } from '../resolution/conformance.ts';
import { metThroughTraits } from '../resolution/trait-calls.ts';
import {
  fieldOf,
  knownConstraints,
  requiredFields,
  requiredFunctions,
  substituteConstraint,
} from '../traits/constraints.ts';
import { type FieldMember, type ParameterKey, type Type, tupleElements } from '../types/type.ts';
import { parametersIn } from '../types/type-parts.ts';
import { searchSite } from '../use-site.ts';

const noMembers: TypeMembers = { fields: [], variants: [], methods: [], statics: [] };

export function membersOf(
  checker: CheckerContext,
  module: ModuleId,
  type: Type,
  access: MemberAccess | undefined,
): TypeMembers {
  if (type.kind === 'error') {
    return noMembers;
  }
  return {
    fields: fieldsOf(checker, type),
    variants: (type.kind === 'nominal' ? checker.variantsOf(type) : undefined) ?? [],
    methods: methodsOf(checker, module, type, access),
    statics: staticsOf(checker, module, type),
  };
}

/** A struct's fields, a tuple's elements, or what the constraints on `type` require, as read. */
function fieldsOf(checker: CheckerContext, type: Type): readonly FieldMember[] {
  const elements = tupleElements(type);
  if (elements !== undefined) {
    return elements.map((element, index) => ({ name: String(index), type: element }));
  }
  const required = knownConstraints(checker, type)
    .flatMap(({ trait }) => requiredFields(trait))
    .flatMap(({ name }) => fieldOf(checker, type, name.text)?.member ?? []);
  return checker.fieldsOf(type) ?? [...new Map(required.map((each) => [each.name, each])).values()];
}

/** The static functions a call through `type` may choose, seen from `module`. */
function staticsOf(
  checker: CheckerContext,
  module: ModuleId,
  type: Type,
): readonly FunctionDeclaration[] {
  const target = staticTargetOf(checker, type);
  switch (target?.kind) {
    case 'owner':
      return staticFunctionsAmong(checker, modulesSeenFrom(checker, module), target);
    case 'parameter': {
      const names = knownConstraints(checker, type).flatMap(({ trait }) =>
        requiredFunctions(trait).flatMap(({ owner, name }) =>
          owner === undefined ? [] : name.text,
        ),
      );
      return [
        ...new Set(
          names.flatMap((name) =>
            staticCandidates(checker, module, target, name).map(({ declaration }) => declaration),
          ),
        ),
      ];
    }
    default:
      return [];
  }
}

/** The methods a call through a value of `type` may choose, and through `access` if given. */
function methodsOf(
  checker: CheckerContext,
  module: ModuleId,
  type: Type,
  access: MemberAccess | undefined,
): readonly FunctionDeclaration[] {
  const found = new Set<FunctionDeclaration>();
  for (const name of methodNames(checker, module, type)) {
    const candidates = metThroughTraits(checker, topLevelCandidates(checker, module, name, [type]));
    const callable =
      access === undefined ? candidates : callableThrough(checker, access, candidates);
    for (const candidate of callable) {
      if (takesAsSelf(checker, candidate, type)) {
        found.add(candidate.declaration);
      }
    }
  }
  return [...found];
}

/** The names a method of `type` may have, seen from `module`. */
function methodNames(checker: CheckerContext, module: ModuleId, type: Type): ReadonlySet<string> {
  const { bindings, inputs } = checker;
  const target = staticTargetOf(checker, type);
  const exporting = [
    inputs.role('prelude'),
    target?.kind === 'owner' ? target.module : undefined,
  ].filter((each) => each !== undefined);
  const items = inputs.itemsOf(module);
  return new Set([
    ...declaredFunctions({ items }).map(({ name }) => name.text),
    ...items.flatMap((item) =>
      item.kind === 'NamedImport' ? item.names.map(({ text }) => text) : [],
    ),
    ...exporting.flatMap((each) => [...bindings.exportsOf(each).keys()]),
    ...knownConstraints(checker, type).flatMap(({ trait }) =>
      requiredFunctions(trait).map(({ name }) => name.text),
    ),
  ]);
}

/**
 * Whether `candidate` is a method a call through a value of `type` may choose, its other arguments
 * aside: its `self` takes the value as the call's receiver, and the type parameters that decides
 * meet their constraints.
 */
function takesAsSelf(checker: CheckerContext, candidate: Candidate, type: Type): boolean {
  const { declaration, requirement } = candidate;
  if (!isMethod(declaration)) {
    return false;
  }
  const { typeParameters, parameters } = signatureOf(
    checker,
    declaration,
    requirement?.substitution,
  );
  const taken = takenBy(
    checker,
    { typeParameters, parameters: parameters.slice(0, 1) },
    {
      callArguments: [{ type, passing: 'receiver' }],
      written: undefined,
      binder: bindArguments,
    },
  );
  return 'inference' in taken && meetsWhereFound(checker, typeParameters, taken.inference);
}

/**
 * Whether the type parameters `inference` found meet their constraints. A parameter still open, or
 * a constraint mentioning one, waits for the arguments that decide it.
 */
function meetsWhereFound(
  checker: CheckerContext,
  parameters: readonly TypeParameter[],
  inference: Inference,
): boolean {
  const site = searchSite(checker);
  const substitution = inference.substitution();
  const isOpen = (parameter: ParameterKey) =>
    inference.isUnknown(parameter) && inference.boundOf(parameter) === undefined;
  return parameters.every((parameter) => {
    const found = inference.boundOf(parameter);
    return (
      found === undefined ||
      checker.constraintsOf(parameter).every((constraint) => {
        const mapped = substituteConstraint(constraint, substitution);
        return mapped.arguments.flatMap(parametersIn).some(isOpen) || meets(site, found, mapped);
      })
    );
  });
}
