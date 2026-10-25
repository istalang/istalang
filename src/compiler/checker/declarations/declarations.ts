/**
 * Checking a module's top-level declarations, one handler per kind: what each declares is
 * resolved, and every function body is checked. A module's diagnostics are complete once each of
 * its declarations has been through here.
 *
 * - A declaration's type parameters have their constraints resolved, and so does every member of
 *   a trait: its functions' signatures and its fields' types.
 * - An alias is resolved, which reports one that refers to itself (§3.17).
 * - An extern a host implements may not send code to the host (rules/host-boundary.ts).
 * - A `dispose` a program declares makes its type disposable, on its rules (rules/disposal.ts).
 * - Imports declare nothing to check.
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Declaration, FunctionDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { checkDisposeDeclaration, isDisposeFunction } from '../rules/disposal.ts';
import { checkHostBoundary } from '../rules/host-boundary.ts';
import { type GenericDeclaration, typeParametersOf } from './resolve-type.ts';
import { checkFiniteFields } from './struct-rules.ts';

const nothingToCheck = (): void => undefined;

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
  checkTypeParameters(checker, node);
  checker.parametersOf(node);
  checker.defaultsOf(node);
  checker.resultOf(node);
  checker.bodyOf(node);
  if (node.isExtern) {
    checkHostBoundary(checker, checker.moduleOf(node), node);
  }
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const declarationHandlers: Handlers<CheckerContext, Declaration, [ModuleId], void> = {
  NamedImport: nothingToCheck,
  NamespaceImport: nothingToCheck,
  ExternStructDeclaration: checkTypeParameters,
  TraitDeclaration: (checker, node, module) => {
    checkTypeParameters(checker, node);
    for (const member of node.members) {
      if (member.kind === 'FunctionDeclaration') {
        checkFunction(checker, member);
      } else if (member.kind === 'FieldDeclaration') {
        checker.resolveType(module, member.type);
      }
    }
  },
  TypeAliasDeclaration: (checker, node) => {
    checkTypeParameters(checker, node);
    checker.aliasedType(node);
  },
  StructDeclaration: (checker, node) => {
    checkTypeParameters(checker, node);
    checker.declaredFieldsOf(node);
    checkFiniteFields(checker, node);
  },
  EnumDeclaration: (checker, node) => {
    checkTypeParameters(checker, node);
    checker.declaredVariantsOf(node);
  },
  ExternConstantDeclaration: (checker, node, module) => {
    checker.resolveType(module, node.type);
    checkHostBoundary(checker, module, node);
  },
  FunctionDeclaration: (checker, node) => {
    checkFunction(checker, node);
    if (isDisposeFunction(checker, node)) {
      checkDisposeDeclaration(checker, node);
    }
  },
  VariableDeclaration: (checker, node) => {
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
