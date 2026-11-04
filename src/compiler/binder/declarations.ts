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

import { selfType } from '../../language/well-known.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import {
  type Declaration,
  type DeclaredStruct,
  type EnumDeclaration,
  type ExternStructDeclaration,
  type FunctionDeclaration,
  type TraitDeclaration,
  type TypeAliasDeclaration,
  type TypeParameters,
  typeParametersOf,
  type Variant,
} from '../syntax/declarations.ts';
import type { Lambda, Parameter } from '../syntax/expressions/index.ts';
import { fieldsFunctionOf } from '../syntax/field-defaults.ts';
import type { Invalid } from '../syntax/node.ts';
import { endOf } from '../syntax/positions.ts';
import { bodyOf, type SyntaxNode } from '../syntax/tree.ts';
import { selfEntity, typeEntity, variableEntity } from './entities.ts';
import { holdsNoNames, type LocalBinder } from './local-binder.ts';
import { Scope } from './scope.ts';
import { bindTargets, bindVariableValue, spanThrough } from './statements.ts';
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
  binder.enter(node, inner);
  bindParameters(binder, node, inner);
  if (node.returnType !== undefined) {
    binder.walk.type(binder, node.returnType, inner);
  }
  const body = Scope.ofBody(inner, node);
  if (node.kind === 'Lambda') {
    binder.walk.expression(binder, node.body, body);
    return;
  }
  const block = bodyOf(binder.tree, node);
  if (block !== undefined) {
    binder.walk.block(binder, block, body);
  }
}

function bindParameters(
  binder: LocalBinder,
  node: FunctionDeclaration | Lambda,
  scope: Scope,
): void {
  for (const parameter of node.parameters) {
    if (parameter.kind === 'Parameter' && parameter.type !== undefined) {
      binder.walk.type(binder, parameter.type, scope);
    }
  }
  bindDefaults(binder, { node, parameters: node.parameters }, scope, (parameter) =>
    binder.declareVariable(scope, parameter.name, parameter),
  );
}

/**
 * The defaults of a struct's or a variant's fields, each seeing the fields before it (§3.1). The
 * fields' names were checked, repeats reported, and their types bound, with the fields.
 */
function bindFieldDefaults(
  binder: LocalBinder,
  owner: DeclaredStruct | Variant,
  fieldsFunction: FunctionDeclaration | undefined,
  scope: Scope,
): void {
  if (fieldsFunction === undefined) {
    return;
  }
  const inner = Scope.nested(scope);
  bindDefaults(binder, { node: owner, parameters: fieldsFunction.parameters }, inner, (field) => {
    binder.declare(inner, field.name, variableEntity(field.name, field), { clash: false });
  });
}

/** Parameters, or fields as their function's parameters, and the node in the tree declaring them. */
interface DeclaredParameters {
  readonly node: SyntaxNode;
  readonly parameters: readonly (Parameter | Invalid)[];
}

/**
 * Each parameter is defined after its default, which sees only the ones before it; past it, the
 * declaring node sees it too.
 */
function bindDefaults(
  binder: LocalBinder,
  { node, parameters }: DeclaredParameters,
  scope: Scope,
  define: (parameter: Parameter) => void,
): void {
  for (const parameter of parameters) {
    if (parameter.kind === 'Parameter') {
      if (parameter.defaultValue !== undefined) {
        binder.walk.expression(binder, parameter.defaultValue, scope);
      }
      define(parameter);
      binder.enter(node, scope, endOf(parameter.span));
    }
  }
}

function bindStruct(binder: LocalBinder, node: DeclaredStruct, scope: Scope): void {
  const inner = typeParameterScope(binder, node, scope);
  bindFields(binder, node.fields, inner);
  bindFieldDefaults(binder, node, fieldsFunctionOf(node), inner);
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const declarationHandlers: Handlers<LocalBinder, Declaration, [Scope], void> = {
  FunctionDeclaration: bindFunction,
  VariableDeclaration: (binder, node, scope) => {
    bindVariableValue(binder, node, scope);
    bindTargets(binder, node, scope, undefined);
  },
  ExternConstantDeclaration: (binder, node, scope) => binder.walk.type(binder, node.type, scope),
  StructDeclaration: bindStruct,
  SharedStructDeclaration: bindStruct,
  ExternStructDeclaration: (binder, node, scope) => {
    typeParameterScope(binder, node, scope);
  },
  TypeAliasDeclaration: (binder, node, scope) =>
    binder.walk.type(binder, node.type, typeParameterScope(binder, node, scope)),
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
  const inner = typeParameterScope(binder, node, scope);
  for (const variant of node.variants) {
    binder.annotations(variant, inner);
    if (variant.kind === 'Variant') {
      bindFields(binder, variant.fields, inner);
      bindFieldDefaults(binder, variant, fieldsFunctionOf(node, variant), inner);
    }
  }
}

function bindTrait(binder: LocalBinder, node: TraitDeclaration, scope: Scope): void {
  const inner = Scope.nested(scope);
  inner.define(selfType, selfEntity(node));
  defineTypeParameters(binder, node.typeParameters, inner);
  binder.enter(node, inner);
  const fields = node.members.filter((member) => member.kind !== 'FunctionDeclaration');
  bindFields(binder, fields, inner);
  for (const member of node.members) {
    if (member.kind === 'FunctionDeclaration') {
      binder.annotations(member, inner);
      binder.checkConvention(member.name, 'value');
      bindFunction(binder, member, inner);
    }
  }
  const last = node.members.at(-1);
  binder.enter(node, inner, endOf(last === undefined ? node.span : spanThrough(binder, last)));
}

/** The scope of a declaration's type parameters, which the whole declaration sees. */
function typeParameterScope(
  binder: LocalBinder,
  node: DeclaredStruct | ExternStructDeclaration | TypeAliasDeclaration | EnumDeclaration,
  scope: Scope,
): Scope {
  const inner = Scope.nested(scope);
  defineTypeParameters(binder, node.typeParameters, inner);
  binder.enter(node, inner);
  return inner;
}

function defineTypeParameters(binder: LocalBinder, parameters: TypeParameters, scope: Scope): void {
  const declared = typeParametersOf(parameters);
  for (const parameter of declared) {
    binder.declare(scope, parameter.name, typeEntity(parameter), { convention: 'type' });
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
