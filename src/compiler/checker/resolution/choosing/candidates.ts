/**
 * Which functions a call may mean (§3.7, §3.10, §3.13), before its arguments choose one:
 *
 * - the functions its name denotes where it is written, the prelude's joined (the binder's set);
 * - argument-dependent lookup: the exported functions of that name in the modules declaring the
 *   arguments' own types, not their type arguments' (a primitive's is the prelude);
 * - the functions the constraints on a type parameter require, for every type parameter the
 *   arguments mention, so generic code calls `add(x, y)` on `T is Addable` like any other; and so
 *   for every `any` type they mention, whose value's own type decides the function (§3.10);
 * - for a call written in a module on a union, the functions of its name that the traits visible
 *   there require (../conformance/union-traits.ts), which choosing tries only where no function
 *   takes the union whole (§6): a union has no module, so argument-dependent lookup finds nothing
 *   for it.
 *
 * A static function (`Duration.zero()`, `T.zero()`) is chosen among those declared on its type and
 * visible where it is called: in the calling module, the type's module, the prelude, or a module
 * the caller imports (§3.7); on a type parameter, among its constraints' static requirements. A
 * shape has no module (§3.13), so argument-dependent lookup finds nothing for it, and its static
 * functions are those the caller sees (§3.17).
 *
 * A witness of a trait's requirement (§3.10) is chosen among the functions declared beside the
 * types it takes, which argument-dependent lookup finds, or beside the trait, never among what the
 * use site sees, so a type meets a trait with the same functions in every module that uses it: the
 * coherence Rust's orphan rule gives. A module declaring a trait declares its functions for types
 * whose modules can't, such as primitives, and no caller has to import them.
 */

import type { ModuleId } from '../../../program/program.ts';
import type {
  FunctionDeclaration,
  TraitDeclaration,
  TypeParameter,
} from '../../../syntax/declarations/index.ts';
import type { MemberAccess } from '../../../syntax/expressions/index.ts';
import { isPlace } from '../../../syntax/expressions/places.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { anyTypesIn, computedTypesIn, parametersIn } from '../../types/parts/type-parts.ts';
import type { Requirement } from '../../types/traits/constraints.ts';
import { requirementsNamed } from '../../types/traits/known-constraints.ts';
import { type ComputedType, isComputed } from '../../types/type/computed-types.ts';
import type { AnyType, Type } from '../../types/type/index.ts';
import { type StaticOwner, staticOwnerOf } from '../../types/written/named-types.ts';
import { traitCallsOn } from '../conformance/union-traits.ts';

/** A function a call may mean; a requirement is one a constraint provides. */
export interface Candidate {
  readonly declaration: FunctionDeclaration;
  readonly requirement?: Requirement;
}

/**
 * What a static call is made through: a declared type, a primitive or a shape, with the module
 * declaring it, which a shape has none of; or a type known only per instantiation, a type
 * parameter or a type computed from one (`R.Data`, §3.1), through its constraints.
 */
export type StaticTarget =
  | {
      readonly kind: 'owner';
      readonly owner: StaticOwner;
      readonly module: ModuleId | undefined;
    }
  | { readonly kind: 'constrained'; readonly on: TypeParameter | ComputedType };

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
  return [
    ...callCandidates(checker, namedInModule(checker, module, name), name, argumentTypes),
    ...traitCallCandidates(checker, module, name, argumentTypes),
  ];
}

/**
 * The calls of `name` on a union, the first of `argumentTypes`, through the traits visible in
 * `module`; none for a call on anything else.
 */
function traitCallCandidates(
  checker: CheckerContext,
  module: ModuleId,
  name: string,
  argumentTypes: readonly (Type | undefined)[],
): readonly Candidate[] {
  const [receiver] = argumentTypes;
  return receiver?.kind === 'union'
    ? visibleTraits(checker, module).flatMap((trait) =>
        traitCallsOn(checker, receiver, trait, name),
      )
    : [];
}

/** The traits visible in `module`: its own, and those the modules it sees export. */
function visibleTraits(checker: CheckerContext, module: ModuleId): readonly TraitDeclaration[] {
  const { inputs, bindings } = checker;
  const own = inputs.itemsOf(module).filter((item) => item.kind === 'TraitDeclaration');
  const exported = modulesSeenFrom(checker, module)
    .filter((each) => each !== module)
    .flatMap((each) =>
      [...bindings.exportsOf(each).values()].flatMap((entity) =>
        entity.kind === 'type' && entity.declaration.kind === 'TraitDeclaration'
          ? [entity.declaration]
          : [],
      ),
    );
  return [...new Set([...own, ...exported])];
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

/**
 * The methods of `methods` a call through `callee`, a member access, may mean: one taking `&self`
 * only when the access is a place (§3.7), since what it changes must be the caller's own. Whether
 * that place may change is judged once one is chosen (resolution/calls/places.ts).
 */
export function callableThrough(
  checker: Pick<CheckerContext, 'parametersOf'>,
  callee: MemberAccess,
  methods: readonly Candidate[],
): readonly Candidate[] {
  return isPlace(callee)
    ? methods
    : methods.filter(({ declaration }) => checker.parametersOf(declaration)[0]?.reference !== true);
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
  return staticCandidatesIn(checker, modulesSeenFrom(checker, module), target, name);
}

/** The modules whose declarations `module` sees: its own, those it imports, and the prelude. */
export function modulesSeenFrom(
  checker: Pick<CheckerContext, 'inputs'>,
  module: ModuleId,
): readonly ModuleId[] {
  const { inputs } = checker;
  const prelude = inputs.role('prelude');
  return [module, ...inputs.importedBy(module), ...(prelude === undefined ? [] : [prelude])];
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
  if (target.kind === 'constrained') {
    return requirementsNamed(checker, target.on, name)
      .filter((requirement) => requirement.declaration.owner !== undefined)
      .map((requirement) => ({ declaration: requirement.declaration, requirement }));
  }
  return staticFunctionsAmong(checker, modules, target)
    .filter((declaration) => declaration.name.text === name)
    .map((declaration) => ({ declaration }));
}

/** The static functions on `target`'s type declared in its own module or one of `modules`. */
export function staticFunctionsAmong(
  checker: Pick<CheckerContext, 'staticFunctionsIn'>,
  modules: readonly ModuleId[],
  target: Extract<StaticTarget, { readonly kind: 'owner' }>,
): readonly FunctionDeclaration[] {
  const declaring = target.module === undefined ? [] : [target.module];
  return [...new Set([...modules, ...declaring])].flatMap((each) =>
    checker.staticFunctionsIn(each, target.owner),
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

/**
 * The module declaring `type`: a nominal type's own, a primitive's the prelude; none for others,
 * a shape among them (§3.13).
 */
function declaringModule(checker: CheckerContext, type: Type): ModuleId | undefined {
  const target = staticTargetOf(checker, type);
  return target?.kind === 'owner' ? target.module : undefined;
}

/** What brings the functions its constraints require as candidates (§3.10). */
type RequirementHolder = TypeParameter | AnyType | ComputedType;

/** The type parameters, `any` types and computed types `type` mentions. */
function requirementHoldersIn(type: Type): readonly RequirementHolder[] {
  return [
    ...parametersIn(type).filter((parameter) => parameter.kind === 'TypeParameter'),
    ...anyTypesIn(type),
    ...computedTypesIn(type),
  ];
}

/**
 * The functions named `name` that constraints require on the type parameters, `any` types and
 * computed types the arguments mention, in that order, each once (an `any` or computed type by its
 * key); static ones are called through their type instead.
 */
function requirementCandidates(
  checker: CheckerContext,
  name: string,
  argumentTypes: readonly Type[],
): readonly Candidate[] {
  const holders = argumentTypes.flatMap(requirementHoldersIn);
  if (holders.length === 0) {
    // Most calls' arguments mention none; every call asks.
    return [];
  }
  const parameters = new Set<TypeParameter>();
  const anyTypes = new Map<string, AnyType>();
  const computed = new Map<string, ComputedType>();
  for (const holder of holders) {
    if (holder.kind === 'TypeParameter') {
      parameters.add(holder);
    } else if (holder.kind === 'any') {
      anyTypes.set(checker.typeKeys.typeKey(holder), holder);
    } else {
      computed.set(checker.typeKeys.typeKey(holder), holder);
    }
  }
  return [...parameters, ...anyTypes.values(), ...computed.values()]
    .flatMap((holder) => requirementsNamed(checker, holder, name))
    .filter((requirement) => requirement.declaration.owner === undefined)
    .map((requirement) => ({ declaration: requirement.declaration, requirement }));
}

/** What static calls through `type` look at; undefined for a type with no static functions. */
export function staticTargetOf(checker: CheckerContext, type: Type): StaticTarget | undefined {
  if (type.kind === 'parameter') {
    return type.declaration.kind === 'TypeParameter'
      ? { kind: 'constrained', on: type.declaration }
      : undefined;
  }
  if (isComputed(type)) {
    return { kind: 'constrained', on: type };
  }
  const owner = staticOwnerOf(type);
  if (owner === undefined) {
    return undefined;
  }
  if (type.kind === 'nominal') {
    return { kind: 'owner', owner, module: checker.moduleOf(type.entity.declaration) };
  }
  if (type.kind === 'primitive') {
    const prelude = checker.inputs.role('prelude');
    return prelude === undefined ? undefined : { kind: 'owner', owner, module: prelude };
  }
  return { kind: 'owner', owner, module: undefined };
}
