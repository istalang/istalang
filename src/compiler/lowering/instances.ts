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
 * - A lambda or local function (§3.14) is an entry of its own per instance of the top-level
 *   function holding it: it is checked within that body, so it reads the body through the same
 *   substitution, and its key is the instance's plus its node. A lambda in a top-level constant's
 *   value is one entry, owned by the constant, which has no type parameters to substitute.
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
  substituteFunction,
  type Type,
} from '../checker/types/type.ts';
import type { TypeKeys } from '../checker/types/type-keys.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Lambda } from '../syntax/expressions.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
import { qualifiedNameOf, spelledType } from './names.ts';

/** One function-table entry's function: a closed call, with every type concrete. */
export interface FunctionInstance {
  readonly declaration: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
  readonly arity: number;
}

/** A lambda or local function inside one instance of the top-level function holding it. */
export interface NestedInstance {
  readonly owner: BodyOwner;
  readonly node: Lambda | FunctionDeclaration;
}

/** What a lowered body belongs to: an instance of a function, or a top-level constant's value. */
export type BodyOwner =
  | { readonly kind: 'function'; readonly instance: FunctionInstance }
  | { readonly kind: 'constant'; readonly declaration: VariableDeclaration };

/** The declaration `owner` is: its function's, or the constant's. */
export function ownerDeclaration(owner: BodyOwner): FunctionDeclaration | VariableDeclaration {
  return owner.kind === 'function' ? owner.instance.declaration : owner.declaration;
}

/** How `owner` maps type parameters: its instance's arguments; a constant has none. */
export function ownerSubstitution(owner: BodyOwner): Substitution {
  return owner.kind === 'function' ? substitutionOf(owner.instance) : new Map();
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

/** The instance a call resolved inside the body of `within` targets. */
export function calleeOf(resolved: ResolvedCall, within: BodyOwner): FunctionInstance {
  return instanceOfCall(close(resolved, within.kind === 'function' ? within.instance : undefined));
}

/** The instance a closed call targets: its function, every type concrete. */
export function instanceOfCall(call: FunctionCall): FunctionInstance {
  return {
    declaration: call.function,
    typeArguments: call.typeArguments,
    witnesses: call.witnesses,
    arity: call.arity,
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
    functionOf: (node) => {
      const checked = body.functionOf(node);
      return checked === undefined
        ? undefined
        : {
            ...checked,
            type: substituteFunction(checked.type, substitution),
            captures: checked.captures.map((captured) => ({
              ...captured,
              type: substitute(captured.type, substitution),
            })),
          };
    },
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

/** The key of a nested function's entry: its owner's, then its node's identity. */
export function nestedKey(keys: TypeKeys, nested: NestedInstance): string {
  const { owner, node } = nested;
  const ownerKey =
    owner.kind === 'function'
      ? instanceKey(keys, owner.instance)
      : `const ${keys.identityOf(owner.declaration)}`;
  return `${ownerKey}#${keys.identityOf(node)}`;
}

/** A nested function's name: its owner's, then its own name, or where a lambda stands. */
export function nestedName(checker: Checker, nested: NestedInstance, where: string): string {
  const { owner, node } = nested;
  const own = node.name === undefined ? `lambda@${where}` : node.name.text;
  const outer =
    owner.kind === 'function'
      ? instanceName(checker, owner.instance)
      : qualifiedNameOf(checker, owner.declaration);
  return `${outer}.${own}`;
}

/** The key two instances share exactly when they are one entry. */
export function instanceKey(keys: TypeKeys, instance: FunctionInstance): string {
  const typeArguments = instance.typeArguments.map((type) => keys.typeKey(type));
  const witnesses = witnessesKey(keys, instance.witnesses);
  return `${keys.identityOf(instance.declaration)}<${typeArguments.join(',')}>[${witnesses}]/${instance.arity}`;
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

/**
 * `resolved`, closed inside `within`: type arguments substituted, requirements their witnesses.
 * A constant's value is within no instance, so nothing in it names a type parameter.
 */
function close(resolved: ResolvedCall, within: FunctionInstance | undefined): FunctionCall {
  const substitution =
    within === undefined ? new Map<ParameterKey, Type>() : substitutionOf(within);
  if (resolved.kind === 'function') {
    return {
      ...resolved,
      typeArguments: resolved.typeArguments.map((type) => substitute(type, substitution)),
      witnesses: closeWitnesses(resolved.witnesses, within),
    };
  }
  const { parameter, constraint, member } = resolved.requirement;
  const witness = within?.witnesses.get(parameter)?.[constraint]?.[member];
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

function closeWitnesses(witnesses: Witnesses, within: FunctionInstance | undefined): Witnesses {
  return new Map(
    [...witnesses].map(([parameter, constraints]) => [
      parameter,
      constraints.map((calls) => calls.map((call) => close(call, within))),
    ]),
  );
}

function witnessesKey(keys: TypeKeys, witnesses: Witnesses): string {
  return [...witnesses.values()]
    .map((constraints) =>
      constraints
        .map((calls) =>
          calls
            .map((call) =>
              call.kind === 'function'
                ? instanceKey(keys, {
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
