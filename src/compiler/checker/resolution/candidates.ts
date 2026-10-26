/**
 * Which functions a call may mean (§3.7, §3.10, §3.13), before its arguments choose one:
 *
 * - the functions its name denotes where it is written, the prelude's joined (the binder's set);
 * - argument-dependent lookup: the exported functions of that name in the modules declaring the
 *   arguments' own types, not their type arguments', except that a `Shared<T>` counts `T`'s, as the
 *   way a module makes a resource type of its own (§7);
 * - the functions the constraints on a type parameter require, for every type parameter the
 *   arguments mention, so generic code calls `add(x, y)` on `T is Addable` like any other.
 *
 * A static function (`Duration.zero()`, `T.zero()`) is chosen among those declared on its type
 * and visible where it is called: in the calling module, the type's module, the prelude, or a
 * module the caller imports (§3.7); on a type parameter, among its constraints' static requirements.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration, TypeParameter } from '../../syntax/declarations.ts';
import type { CheckerContext, StaticOwner } from '../context.ts';
import { type Requirement, requirementsNamed } from '../traits/constraints.ts';
import { type NominalType, parametersIn, type Type } from '../types/type.ts';
import { wellKnownArguments } from '../types/well-known.ts';

/** A function a call may mean; a requirement is one a constraint provides. */
export interface Candidate {
  readonly declaration: FunctionDeclaration;
  readonly requirement?: Requirement;
}

/** What a static call is made through: a declared type or primitive, or a type parameter. */
export type StaticTarget =
  | { readonly kind: 'owner'; readonly owner: StaticOwner; readonly module: ModuleId }
  | { readonly kind: 'parameter'; readonly parameter: TypeParameter };

/**
 * The candidates of a call of `name` written in `module` without a namespace, as an operator, a
 * method and a requirement's witness are: the functions its top level sees, then ADL's.
 */
export function topLevelCandidates(
  checker: CheckerContext,
  module: ModuleId,
  name: string,
  argumentTypes: readonly (Type | undefined)[],
): readonly Candidate[] {
  return callCandidates(checker, namedInModule(checker, module, name), name, argumentTypes);
}

/** The candidates of a call of `name`: `named` in scope, then those its arguments bring. */
export function callCandidates(
  checker: CheckerContext,
  named: readonly FunctionDeclaration[],
  name: string,
  argumentTypes: readonly (Type | undefined)[],
): readonly Candidate[] {
  const given = argumentTypes.filter((type) => type !== undefined);
  const declarations = new Set([...named, ...argumentDependent(checker, name, given)]);
  return [
    ...[...declarations].map((declaration) => ({ declaration })),
    ...requirementCandidates(checker, name, given),
  ];
}

/** The functions an operator's name denotes in `module` (§3.9). */
function namedInModule(
  checker: CheckerContext,
  module: ModuleId,
  name: string,
): readonly FunctionDeclaration[] {
  const entity = checker.bindings.topLevelNamed(module, name);
  return entity?.kind === 'functions' ? checker.bindings.overloadsOf(entity) : [];
}

/** The candidates of a static call of `name` through `target`, seen from `module`. */
export function staticCandidates(
  checker: CheckerContext,
  module: ModuleId,
  target: StaticTarget,
  name: string,
): readonly Candidate[] {
  if (target.kind === 'parameter') {
    return requirementsNamed(checker, target.parameter, name)
      .filter((requirement) => requirement.declaration.owner !== undefined)
      .map((requirement) => ({ declaration: requirement.declaration, requirement }));
  }
  const { program } = checker;
  const visible = new Set<ModuleId>([module, target.module]);
  for (const imported of program.modules.get(module)?.imports.values() ?? []) {
    visible.add(imported);
  }
  if (program.roles.prelude !== undefined) {
    visible.add(program.roles.prelude);
  }
  return [...visible].flatMap((each) =>
    checker
      .staticFunctionsIn(each, target.owner)
      .filter((declaration) => declaration.name.text === name)
      .map((declaration) => ({ declaration })),
  );
}

function argumentDependent(
  checker: CheckerContext,
  name: string,
  argumentTypes: readonly Type[],
): readonly FunctionDeclaration[] {
  const { bindings } = checker;
  return argumentTypes.flatMap((argument) =>
    lookupTypes(checker, argument).flatMap((type) => {
      const module = bindings.moduleOf(type.entity);
      const entity = module === undefined ? undefined : bindings.exportsOf(module).get(name);
      return entity?.kind === 'functions' ? bindings.overloadsOf(entity) : [];
    }),
  );
}

/** The types whose modules lookup searches for an argument of `type` (§3.13). */
function lookupTypes(checker: CheckerContext, type: Type): readonly NominalType[] {
  if (type.kind !== 'nominal') {
    return [];
  }
  const [held] = wellKnownArguments(checker, wellKnown.shared, type) ?? [];
  return held?.kind === 'nominal' ? [type, held] : [type];
}

function requirementCandidates(
  checker: CheckerContext,
  name: string,
  argumentTypes: readonly Type[],
): readonly Candidate[] {
  const parameters = new Set(argumentTypes.flatMap(parametersIn));
  return [...parameters].flatMap((parameter) =>
    parameter.kind === 'TypeParameter'
      ? requirementsNamed(checker, parameter, name)
          .filter((requirement) => requirement.declaration.owner === undefined)
          .map((requirement) => ({ declaration: requirement.declaration, requirement }))
      : [],
  );
}

/** What static calls through `type` look at; undefined for a type with no static functions. */
export function staticTargetOf(checker: CheckerContext, type: Type): StaticTarget | undefined {
  switch (type.kind) {
    case 'primitive': {
      const { prelude } = checker.program.roles;
      return prelude === undefined
        ? undefined
        : { kind: 'owner', owner: type.name, module: prelude };
    }
    case 'nominal':
      return {
        kind: 'owner',
        owner: type.entity.declaration,
        module: checker.moduleOf(type.entity.declaration),
      };
    case 'parameter':
      return type.declaration.kind === 'TypeParameter'
        ? { kind: 'parameter', parameter: type.declaration }
        : undefined;
    default:
      return undefined;
  }
}
