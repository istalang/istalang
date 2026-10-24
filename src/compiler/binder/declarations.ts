/**
 * Binding names inside declarations: functions and lambdas, and the parts of type declarations
 * (§3.1, §3.3, §3.5, §3.10, §3.11, §3.14, §3.17).
 *
 * A declaration's own name is defined by whoever owns its scope: the module for top-level ones
 * (module-scope.ts), the block for a local function. What is bound here is everything inside it.
 *
 * - Type parameters are all defined before any constraint or default is bound, so they may refer
 *   to one another (`<A, B is Convertible<A>>`).
 * - A parameter's default may use the parameters before it (§3.3), so each parameter is defined
 *   after its own type and default are bound.
 * - A named lambda's name is visible only inside the lambda (§3.14).
 * - `Self` is defined in a trait's scope, and only there (§3.10).
 * - A static function's owner (`Duration` in `fn Duration.zero()`) is a type use in the scope
 *   around the function, which inside a trait includes `Self`.
 */

import type {
  Declaration,
  EnumDeclaration,
  FunctionDeclaration,
  TraitDeclaration,
  TypeParameters,
} from '../syntax/declarations.ts';
import type { Lambda, Parameter } from '../syntax/expressions.ts';
import { type Handlers, handlerOf } from '../syntax/handlers.ts';
import type { Invalid } from '../syntax/node.ts';
import { holdsNoNames, type LocalBinder } from './local-binder.ts';
import { Scope } from './scope.ts';
import { bindVariableValue } from './statements.ts';
import { bindFields } from './types.ts';

export function bindFunction(
  binder: LocalBinder,
  node: FunctionDeclaration | Lambda,
  scope: Scope,
): void {
  const inner = Scope.nested(scope);
  if (node.kind === 'FunctionDeclaration') {
    if (node.owner !== undefined) {
      binder.use(node.owner, scope, 'type');
    }
    defineTypeParameters(binder, node.typeParameters, inner);
  } else if (node.name !== undefined) {
    binder.declareVariable(inner, node.name, node);
  }
  bindParameters(binder, node.parameters, inner);
  if (node.returnType !== undefined) {
    binder.walk.type(binder, node.returnType, inner);
  }
  if (node.kind === 'Lambda') {
    binder.walk.expression(binder, node.body, inner);
  } else if (node.body !== undefined) {
    binder.walk.block(binder, node.body, inner);
  }
}

/** Each parameter is defined after its type and default, which see only the ones before it. */
function bindParameters(
  binder: LocalBinder,
  parameters: readonly (Parameter | Invalid)[],
  scope: Scope,
): void {
  for (const parameter of parameters) {
    if (parameter.kind === 'Parameter') {
      if (parameter.type !== undefined) {
        binder.walk.type(binder, parameter.type, scope);
      }
      if (parameter.defaultValue !== undefined) {
        binder.walk.expression(binder, parameter.defaultValue, scope);
      }
      const { name } = parameter;
      binder.declareVariable(scope, name, parameter);
    }
  }
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const declarationHandlers: Handlers<LocalBinder, Declaration, [Scope], void> = {
  FunctionDeclaration: bindFunction,
  VariableDeclaration: bindVariableValue,
  ExternConstantDeclaration: (binder, node, scope) => binder.walk.type(binder, node.type, scope),
  StructDeclaration: (binder, node, scope) =>
    bindFields(binder, node.fields, typeParameterScope(binder, node.typeParameters, scope)),
  ExternStructDeclaration: (binder, node, scope) => {
    typeParameterScope(binder, node.typeParameters, scope);
  },
  TypeAliasDeclaration: (binder, node, scope) =>
    binder.walk.type(binder, node.type, typeParameterScope(binder, node.typeParameters, scope)),
  EnumDeclaration: bindEnum,
  TraitDeclaration: bindTrait,
  NamedImport: holdsNoNames,
  NamespaceImport: holdsNoNames,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** Binds what is inside a top-level declaration, whose name the module scope already defines. */
export function bindDeclaration(binder: LocalBinder, node: Declaration, scope: Scope): void {
  binder.annotations(node, scope);
  handlerOf(declarationHandlers, node)(binder, node, scope);
}

function bindEnum(binder: LocalBinder, node: EnumDeclaration, scope: Scope): void {
  const inner = typeParameterScope(binder, node.typeParameters, scope);
  for (const variant of node.variants) {
    if (variant.kind === 'Variant') {
      binder.annotations(variant, inner);
      bindFields(binder, variant.fields, inner);
    }
  }
}

function bindTrait(binder: LocalBinder, node: TraitDeclaration, scope: Scope): void {
  const inner = Scope.nested(scope);
  inner.define('Self', { kind: 'self', trait: node });
  defineTypeParameters(binder, node.typeParameters, inner);
  const fields = node.members.filter((member) => member.kind !== 'FunctionDeclaration');
  bindFields(binder, fields, inner);
  for (const member of node.members) {
    if (member.kind === 'FunctionDeclaration') {
      binder.annotations(member, inner);
      binder.checkConvention(member.name, 'value');
      bindFunction(binder, member, inner);
    }
  }
}

function typeParameterScope(binder: LocalBinder, parameters: TypeParameters, scope: Scope): Scope {
  const inner = Scope.nested(scope);
  defineTypeParameters(binder, parameters, inner);
  return inner;
}

function defineTypeParameters(binder: LocalBinder, parameters: TypeParameters, scope: Scope): void {
  const declared = parameters.filter((parameter) => parameter.kind === 'TypeParameter');
  for (const parameter of declared) {
    const entity = { kind: 'type', declaration: parameter } as const;
    binder.declare(scope, parameter.name, entity, { convention: 'type' });
  }
  for (const parameter of declared) {
    for (const constraint of parameter.constraints) {
      binder.walk.type(binder, constraint, scope);
    }
    if (parameter.defaultType !== undefined) {
      binder.walk.type(binder, parameter.defaultType, scope);
    }
  }
}
