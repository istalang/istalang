/**
 * Checking a module's top-level declarations, one handler per kind: what each declares is
 * resolved, and every function body is checked. A module's diagnostics are complete once each of
 * its declarations has been through here.
 *
 * - A declaration's type parameters have their constraints resolved, and so does every member of
 *   a trait: its functions' signatures and its fields' types.
 * - An alias is resolved, which reports one that refers to itself (§3.17).
 * - A handle's functions are checked as written ones are (§3.18), and so are the defaults of a
 *   struct's or a variant's fields, as the parameters they read as (§3.1).
 * - An extern a host implements takes and gives only what crosses as JSON (rules/host-boundary.ts),
 *   and so does `main`, whose outcome its host reads (§9).
 * - A `dispose` a program declares makes its type disposable, on its rules (rules/disposal.ts).
 * - Every item's annotations are checked where it stands (rules/annotations.ts): a function's, a
 *   field's and, of the rest, each declaration's, which none may carry.
 * - Imports declare nothing else to check.
 */

import { entryFunction } from '../../../language/well-known.ts';
import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import { isStdModule, type ModuleId } from '../../program/program.ts';
import type { Annotatable } from '../../syntax/annotations.ts';
import type { Declaration, FunctionDeclaration } from '../../syntax/declarations.ts';
import { handleFunctionList } from '../../syntax/declared-functions.ts';
import { fieldsFunctionOf, writtenType } from '../../syntax/field-defaults.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { CheckerContext } from '../context.ts';
import { checkDisposeDeclaration, isDisposeFunction } from '../rules/disposal.ts';
import { checkHostBoundary, crossesToHost } from '../rules/host-boundary.ts';
import { type GenericDeclaration, typeParametersOf } from '../types/resolve-type.ts';
import { futureArgument } from '../types/well-known.ts';
import { checkFiniteFields } from './struct-rules.ts';

/**
 * Resolves the constraints and defaults of `declaration`'s type parameters where they are written,
 * so what they misname, and what their defaults' arguments fail to meet, is reported there.
 */
function checkTypeParameters(checker: CheckerContext, declaration: GenericDeclaration): void {
  for (const parameter of typeParametersOf(declaration.typeParameters)) {
    checker.constraintsOf(parameter);
    if (parameter.defaultType !== undefined) {
      checker.resolveType(checker.moduleOf(declaration), parameter.defaultType);
    }
  }
}

function checkFunction(checker: CheckerContext, node: FunctionDeclaration): void {
  const module = checker.moduleOf(node);
  checkTypeParameters(checker, node);
  checker.annotations.of(module, node, { kind: 'function' });
  checker.parametersOf(node);
  checker.defaultsOf(node);
  checker.resultOf(node);
  checker.bodyOf(node);
  if (node.isExtern) {
    checkHostBoundary(checker, module, node);
  }
}

/** The defaults of a declaration's fields, which read as `fieldsFunction`'s parameters (§3.1). */
function checkFieldDefaults(
  checker: CheckerContext,
  fieldsFunction: FunctionDeclaration | undefined,
): void {
  if (fieldsFunction !== undefined) {
    checker.parametersOf(fieldsFunction);
    checker.defaultsOf(fieldsFunction);
  }
}

/** `main` gives its host an outcome as JSON (§9), so what it gives must be `Encodable`. */
function checkOutcome(checker: CheckerContext, node: FunctionDeclaration, module: ModuleId): void {
  if (node.name.text !== entryFunction || isStdModule(checker.program, module)) {
    return;
  }
  const result = checker.resultOf(node);
  const outcome = futureArgument(checker, result) ?? result;
  crossesToHost(checker, { module, at: node.returnType ?? node.name }, outcome, 'write');
}

/** Checks the annotations on a declaration none may stand on, which `description` names. */
function annotatedNowhere(description: string) {
  return (checker: CheckerContext, node: Annotatable & NodeOf<string>, module: ModuleId): void => {
    checker.annotations.of(module, node, { kind: 'other', description });
  };
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const declarationHandlers: Handlers<CheckerContext, Declaration, [ModuleId], void> = {
  NamedImport: annotatedNowhere('an import'),
  NamespaceImport: annotatedNowhere('an import'),
  ExternStructDeclaration: (checker, node, module) => {
    annotatedNowhere('an extern struct')(checker, node, module);
    checkTypeParameters(checker, node);
  },
  TraitDeclaration: (checker, node, module) => {
    annotatedNowhere('a trait')(checker, node, module);
    checkTypeParameters(checker, node);
    for (const member of node.members) {
      if (member.kind === 'FunctionDeclaration') {
        checkFunction(checker, member);
      } else if (member.kind === 'FieldDeclaration') {
        const type = checker.resolveType(module, writtenType(member));
        checker.annotations.of(module, member, { kind: 'field', type });
      }
    }
  },
  TypeAliasDeclaration: (checker, node, module) => {
    annotatedNowhere('a type alias')(checker, node, module);
    checkTypeParameters(checker, node);
    checker.aliasedType(node);
  },
  HandleDeclaration: (checker, node, module) => {
    annotatedNowhere('a handle')(checker, node, module);
    checkTypeParameters(checker, node);
    for (const declared of handleFunctionList(node)) {
      checkFunction(checker, declared);
    }
  },
  StructDeclaration: (checker, node, module) => {
    annotatedNowhere('a struct declaration')(checker, node, module);
    checkTypeParameters(checker, node);
    checker.annotations.checkFields(checker.declaredFieldsOf(node));
    checkFiniteFields(checker, node);
    checkFieldDefaults(checker, fieldsFunctionOf(node));
  },
  EnumDeclaration: (checker, node, module) => {
    annotatedNowhere('an enum declaration')(checker, node, module);
    checkTypeParameters(checker, node);
    for (const variant of node.variants) {
      if (variant.kind === 'Variant') {
        annotatedNowhere('an enum variant')(checker, variant, module);
        checkFieldDefaults(checker, fieldsFunctionOf(node, variant));
      }
    }
    for (const variant of checker.declaredVariantsOf(node)) {
      checker.annotations.checkFields(variant.fields);
    }
  },
  ExternConstantDeclaration: (checker, node, module) => {
    annotatedNowhere('an extern constant')(checker, node, module);
    checker.resolveType(module, node.type);
    checkHostBoundary(checker, module, node);
  },
  FunctionDeclaration: (checker, node, module) => {
    checkFunction(checker, node);
    checkOutcome(checker, node, module);
    if (isDisposeFunction(checker, node)) {
      checkDisposeDeclaration(checker, node);
    }
  },
  VariableDeclaration: (checker, node, module) => {
    annotatedNowhere('a constant')(checker, node, module);
    checker.constantOf(node);
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** Checks `declaration`, a top-level item of `module`, reporting what it finds. */
export function checkDeclaration(
  checker: CheckerContext,
  module: ModuleId,
  declaration: Declaration,
): void {
  handlerOf(declarationHandlers, declaration)(checker, declaration, module);
}
