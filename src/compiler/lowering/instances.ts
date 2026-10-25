/**
 * Instances (§3.5: generics are compiled per instantiation): what one function-table entry is.
 *
 * - An instance is a declaration with concrete type arguments, the concrete witnesses of its
 *   constraints (§3.10), and how many arguments its callers give: a call leaving parameters to
 *   their defaults targets a generated entry of its own (§3.3).
 * - A body is checked once, generically (checker), so lowering one instance reads the body
 *   through its substitution (`instantiatedBody`), and closes every call it makes: type arguments
 *   naming the instance's own parameters are substituted, and a call to a requirement becomes the
 *   witness the instance was given for it.
 * - Two instances are one entry when their key is: the declaration, its arguments' types, its
 *   witnesses' keys, and its arity.
 */

import type {
  CheckedBody,
  Checker,
  FunctionCall,
  ResolvedCall,
  Witnesses,
} from '../checker/check.ts';
import {
  type ParameterKey,
  type Substitution,
  substitute,
  type Type,
  typeKey,
} from '../checker/types/type.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { qualifiedNameOf, spelledType } from './names.ts';

/** One function-table entry's function: a closed call, with every type concrete. */
export interface FunctionInstance {
  readonly declaration: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
  readonly arity: number;
}

/** The instance `main` is: no type arguments, every argument given. */
export function rootInstance(checker: Checker, declaration: FunctionDeclaration): FunctionInstance {
  return {
    declaration,
    typeArguments: [],
    witnesses: new Map(),
    arity: checker.parametersOf(declaration).length,
  };
}

/** How the instance maps its declaration's type parameters. */
export function substitutionOf(instance: FunctionInstance): Substitution {
  const parameters = instance.declaration.typeParameters.filter(
    (parameter) => parameter.kind === 'TypeParameter',
  );
  return new Map<ParameterKey, Type>(
    parameters.flatMap((parameter, index) => {
      const argument = instance.typeArguments[index];
      return argument === undefined ? [] : [[parameter, argument] as const];
    }),
  );
}

/** The instance a call resolved inside `within` targets. */
export function calleeOf(resolved: ResolvedCall, within: FunctionInstance): FunctionInstance {
  const closed = close(resolved, within);
  return {
    declaration: closed.function,
    typeArguments: closed.typeArguments,
    witnesses: closed.witnesses,
    arity: closed.arity,
  };
}

/** The instance of the same function taking every argument: what a defaults entry calls. */
export function fullInstance(checker: Checker, instance: FunctionInstance): FunctionInstance {
  return { ...instance, arity: checker.parametersOf(instance.declaration).length };
}

/** `body`, as one instance of its function sees it: every type substituted. */
export function instantiatedBody(body: CheckedBody, instance: FunctionInstance): CheckedBody {
  const substitution = substitutionOf(instance);
  return {
    ...body,
    typeOf: (expression) => substitute(body.typeOf(expression), substitution),
    targetsOf: (declaration) =>
      body
        .targetsOf(declaration)
        .map((binding) => ({ ...binding, type: substitute(binding.type, substitution) })),
    chainOf: (link) => {
      const chained = body.chainOf(link);
      return chained === undefined
        ? undefined
        : { ...chained, base: substitute(chained.base, substitution) };
    },
    patternOf: (pattern) => {
      const checked = body.patternOf(pattern);
      return {
        ...checked,
        bindings: checked.bindings.map((binding) => ({
          ...binding,
          type: substitute(binding.type, substitution),
        })),
      };
    },
    result: substitute(body.result, substitution),
  };
}

/** The key two instances share exactly when they are one entry. */
export function instanceKey(instance: FunctionInstance): string {
  return `${declarationKey(instance.declaration)}<${instance.typeArguments
    .map(typeKey)
    .join(',')}>[${witnessesKey(instance.witnesses)}]/${instance.arity}`;
}

/**
 * An instance's name in the Definition (definition.md, "Names"): the declaration's, with its type
 * arguments spelled as keys spell them, and a defaults entry's arity after a `/`.
 */
export function instanceName(checker: Checker, instance: FunctionInstance): string {
  const { declaration, typeArguments, arity } = instance;
  const name = qualifiedNameOf(checker, declaration);
  const generic =
    typeArguments.length === 0
      ? ''
      : `<${typeArguments.map((type) => spelledType(checker, type)).join(', ')}>`;
  const defaults = arity < checker.parametersOf(declaration).length ? `/${arity}` : '';
  return `${name}${generic}${defaults}`;
}

/** `resolved`, closed inside `within`: type arguments substituted, requirements their witnesses. */
function close(resolved: ResolvedCall, within: FunctionInstance): FunctionCall {
  const substitution = substitutionOf(within);
  if (resolved.kind === 'function') {
    return {
      ...resolved,
      typeArguments: resolved.typeArguments.map((type) => substitute(type, substitution)),
      witnesses: closeWitnesses(resolved.witnesses, within),
    };
  }
  const { parameter, constraint, member } = resolved.requirement;
  const witness = within.witnesses.get(parameter)?.[constraint]?.[member];
  if (witness?.kind !== 'function') {
    throw new Error(`No witness for '${parameter.name.text}'; checking should have found one.`);
  }
  const own = new Map<ParameterKey, Type>(substitution);
  resolved.function.typeParameters
    .filter((each) => each.kind === 'TypeParameter')
    .forEach((each, index) => {
      const argument = resolved.typeArguments[index];
      if (argument !== undefined) {
        own.set(each, substitute(argument, substitution));
      }
    });
  return {
    ...witness,
    typeArguments: witness.typeArguments.map((type) => substitute(type, own)),
  };
}

function closeWitnesses(witnesses: Witnesses, within: FunctionInstance): Witnesses {
  return new Map(
    [...witnesses].map(([parameter, constraints]) => [
      parameter,
      constraints.map((calls) => calls.map((call) => close(call, within))),
    ]),
  );
}

function witnessesKey(witnesses: Witnesses): string {
  return [...witnesses.values()]
    .map((constraints) =>
      constraints
        .map((calls) =>
          calls
            .map((call) =>
              call.kind === 'function'
                ? instanceKey({
                    declaration: call.function,
                    typeArguments: call.typeArguments,
                    witnesses: call.witnesses,
                    arity: call.arity,
                  })
                : '?',
            )
            .join(';'),
        )
        .join('|'),
    )
    .join('&');
}

const declarations = new WeakMap<FunctionDeclaration, number>();
let nextDeclaration = 0;

function declarationKey(declaration: FunctionDeclaration): number {
  let key = declarations.get(declaration);
  if (key === undefined) {
    key = nextDeclaration;
    nextDeclaration += 1;
    declarations.set(declaration, key);
  }
  return key;
}
