/**
 * Which functions a call may mean (§3.7, §3.10, §3.13), before its arguments choose one:
 *
 * - the functions its name denotes where it is written, the prelude's joined (the binder's set);
 * - argument-dependent lookup: the exported functions of that name in the modules declaring the
 *   arguments' own types, not their type arguments' (a primitive's is the prelude);
 * - the functions the constraints on a type parameter require, for every type parameter the
 *   arguments mention, so generic code calls `add(x, y)` on `T is Addable` like any other; and so
 *   for every `any` type they mention, whose value's own type decides the function (§3.10).
 *
 * A static function (`Duration.zero()`, `T.zero()`) is chosen among those declared on its type
 * and visible where it is called: in the calling module, the type's module, the prelude, or a
 * module the caller imports (§3.7); on a type parameter, among its constraints' static requirements.
 *
 * A witness of a trait's requirement (§3.10) is chosen among the functions declared beside the
 * types it takes, which argument-dependent lookup finds, or beside the trait, never among what the
 * use site sees, so a type meets a trait with the same functions in every module that uses it: the
 * coherence Rust's orphan rule gives. A module declaring a trait declares its functions for types
 * whose modules can't, such as primitives, and no caller has to import them.
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration, TypeParameter } from '../../syntax/declarations.ts';
import type { CheckerContext, StaticOwner } from '../context.ts';
import { type Requirement, requirementsNamed } from '../traits/constraints.ts';
import type { Type } from '../types/type.ts';
import { anyTypesIn, parametersIn } from '../types/type-parts.ts';

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
 * The candidates of a call of `name` written in `module` without a namespace, as an operator's
 * and a method's are: the functions its top level sees, then ADL's.
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

/** The functions a top-level name denotes in `module`, the prelude's joined (§3.9, §3.13). */
export function namedInModule(
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
  const { program } = checker;
  const imported = program.modules.get(module)?.imports.values() ?? [];
  const prelude = program.roles.prelude === undefined ? [] : [program.roles.prelude];
  return staticCandidatesIn(checker, [module, ...imported, ...prelude], target, name);
}

/**
 * The candidates of a witness of `required`, a trait's requirement taking `parameterTypes`, for
 * `type`: the functions declared beside those types or the trait, a static one on `type` (whose
 * own module counts too), and on a type parameter or an `any` type its constraints' requirements.
 */
export function witnessCandidates(
  checker: CheckerContext,
  type: Type,
  {
    required,
    parameterTypes,
  }: { readonly required: FunctionDeclaration; readonly parameterTypes: readonly Type[] },
): readonly Candidate[] {
  const name = required.name.text;
  const home = checker.moduleOf(required);
  if (required.owner === undefined) {
    return callCandidates(checker, exportedFunctions(checker, home, name), name, parameterTypes);
  }
  const target = staticTargetOf(checker, type);
  const declaring = parameterTypes.flatMap((each) => declaringModule(checker, each) ?? []);
  return target === undefined
    ? []
    : staticCandidatesIn(checker, [home, ...declaring], target, name);
}

/**
 * The candidates of a static call of `name` through `target`: on a type, those declared in its own
 * module or one of `modules`.
 */
function staticCandidatesIn(
  checker: CheckerContext,
  modules: readonly ModuleId[],
  target: StaticTarget,
  name: string,
): readonly Candidate[] {
  if (target.kind === 'parameter') {
    return requirementsNamed(checker, target.parameter, name)
      .filter((requirement) => requirement.declaration.owner !== undefined)
      .map((requirement) => ({ declaration: requirement.declaration, requirement }));
  }
  return [...new Set([...modules, target.module])].flatMap((each) =>
    checker
      .staticFunctionsIn(each, target.owner)
      .filter((declaration) => declaration.name.text === name)
      .map((declaration) => ({ declaration })),
  );
}

/** The functions named `name` the modules declaring `argumentTypes` export (§3.13). */
function argumentDependent(
  checker: CheckerContext,
  name: string,
  argumentTypes: readonly Type[],
): readonly FunctionDeclaration[] {
  return argumentTypes.flatMap((argument) => {
    const module = declaringModule(checker, argument);
    return module === undefined ? [] : exportedFunctions(checker, module, name);
  });
}

/** The functions named `name` that `module` exports. */
function exportedFunctions(
  checker: CheckerContext,
  module: ModuleId,
  name: string,
): readonly FunctionDeclaration[] {
  const { bindings } = checker;
  const entity = bindings.exportsOf(module).get(name);
  return entity?.kind === 'functions' ? bindings.overloadsOf(entity) : [];
}

/** The module declaring `type`: a nominal type's own, a primitive's the prelude; none for others. */
function declaringModule(checker: CheckerContext, type: Type): ModuleId | undefined {
  const target = staticTargetOf(checker, type);
  return target?.kind === 'owner' ? target.module : undefined;
}

/**
 * The functions named `name` that constraints require on the type parameters and `any` types the
 * arguments mention; static ones are called through their type instead.
 */
function requirementCandidates(
  checker: CheckerContext,
  name: string,
  argumentTypes: readonly Type[],
): readonly Candidate[] {
  const parameters = new Set(argumentTypes.flatMap(parametersIn));
  const onParameters = [...parameters].flatMap((parameter) =>
    parameter.kind === 'TypeParameter' ? requirementsNamed(checker, parameter, name) : [],
  );
  const anyTypes = new Map(
    argumentTypes.flatMap(anyTypesIn).map((type) => [checker.typeKeys.typeKey(type), type]),
  );
  const onAnyTypes = [...anyTypes.values()].flatMap((type) =>
    requirementsNamed(checker, type, name),
  );
  return [...onParameters, ...onAnyTypes]
    .filter((requirement) => requirement.declaration.owner === undefined)
    .map((requirement) => ({ declaration: requirement.declaration, requirement }));
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
    case 'nominal': {
      const owner = type.entity.declaration;
      return { kind: 'owner', owner, module: checker.moduleOf(owner) };
    }
    case 'parameter':
      return type.declaration.kind === 'TypeParameter'
        ? { kind: 'parameter', parameter: type.declaration }
        : undefined;
    case 'anonymous':
    case 'tuple':
    case 'function':
    case 'any':
    case 'error':
      return undefined;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
