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
 *   after its own type and default are bound. A field's default may use the fields before it the
 *   same way (§3.1), as a parameter of the function the fields read as
 *   (syntax/field-defaults.ts).
 * - A named lambda's name is visible only inside the lambda (§3.14).
 * - `Self` is defined in a trait's scope, and only there (§3.10).
 * - A static function's owner (`Duration` in `fn Duration.zero()`) is a type use in the scope
 *   around the function, which inside a trait includes `Self`.
 */

import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import {
  type Declaration,
  type EnumDeclaration,
  type FunctionDeclaration,
  type TraitDeclaration,
  type TypeParameters,
  typeParametersOf,
} from '../syntax/declarations.ts';
import type { Lambda, Parameter } from '../syntax/expressions/index.ts';
import { fieldsFunctionOf } from '../syntax/field-defaults.ts';
import type { Invalid } from '../syntax/node.ts';
import { holdsNoNames, type LocalBinder } from './local-binder.ts';
import { Scope } from './scope.ts';
import { bindTargets, bindVariableValue } from './statements.ts';
import { bindFields } from './types.ts';

export function bindFunction(
  binder: LocalBinder,
  node: FunctionDeclaration | Lambda,
  scope: Scope,
): void {
  const inner = Scope.ofFunction(scope, node);
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

function bindParameters(
  binder: LocalBinder,
  parameters: readonly (Parameter | Invalid)[],
  scope: Scope,
): void {
  for (const parameter of parameters) {
    if (parameter.kind === 'Parameter' && parameter.type !== undefined) {
      binder.walk.type(binder, parameter.type, scope);
    }
  }
  bindDefaults(binder, parameters, scope, (parameter) =>
    binder.declareVariable(scope, parameter.name, parameter),
  );
}

/**
 * The defaults of a struct's or a variant's fields, each seeing the fields before it (§3.1). The
 * fields' names were checked, repeats reported, and their types bound, with the fields.
 */
function bindFieldDefaults(
  binder: LocalBinder,
  fieldsFunction: FunctionDeclaration | undefined,
  scope: Scope,
): void {
  if (fieldsFunction === undefined) {
    return;
  }
  const inner = Scope.nested(scope);
  bindDefaults(binder, fieldsFunction.parameters, inner, (field) => {
    const entity = { kind: 'variable', name: field.name, owner: field } as const;
    binder.declare(inner, field.name, entity, { clash: false });
  });
}

/** Each parameter is defined after its default, which sees only the ones before it. */
function bindDefaults(
  binder: LocalBinder,
  parameters: readonly (Parameter | Invalid)[],
  scope: Scope,
  define: (parameter: Parameter) => void,
): void {
  for (const parameter of parameters) {
    if (parameter.kind === 'Parameter') {
      if (parameter.defaultValue !== undefined) {
        binder.walk.expression(binder, parameter.defaultValue, scope);
      }
      define(parameter);
    }
  }
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const declarationHandlers: Handlers<LocalBinder, Declaration, [Scope], void> = {
  FunctionDeclaration: bindFunction,
  VariableDeclaration: (binder, node, scope) => {
    bindVariableValue(binder, node, scope);
    bindTargets(binder, node, scope, undefined);
  },
  ExternConstantDeclaration: (binder, node, scope) => binder.walk.type(binder, node.type, scope),
  StructDeclaration: (binder, node, scope) => {
    const inner = typeParameterScope(binder, node.typeParameters, scope);
    bindFields(binder, node.fields, inner);
    bindFieldDefaults(binder, fieldsFunctionOf(node), inner);
  },
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
      bindFieldDefaults(binder, fieldsFunctionOf(node, variant), inner);
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
  const declared = typeParametersOf(parameters);
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
