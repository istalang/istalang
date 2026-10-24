/**
 * Checking a module's top-level declarations, one handler per kind: what each declares is
 * resolved, and every function body is checked. A module's diagnostics are complete once each of
 * its declarations has been through here.
 *
 * Imports, extern types, traits and type aliases declare nothing that checking needs yet: traits
 * and aliases are checked where they are used, and an unsupported use is reported there, so the
 * prelude's declarations never report.
 */

import type { ModuleId } from '../../program/program.ts';
import type { Declaration } from '../../syntax/declarations.ts';
import { type Handlers, handlerOf } from '../../syntax/handlers.ts';
import type { CheckerContext } from '../context.ts';

const nothingToCheck = (): void => undefined;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const declarationHandlers: Handlers<CheckerContext, Declaration, [ModuleId], void> = {
  NamedImport: nothingToCheck,
  NamespaceImport: nothingToCheck,
  ExternStructDeclaration: nothingToCheck,
  TraitDeclaration: nothingToCheck,
  TypeAliasDeclaration: nothingToCheck,
  StructDeclaration: (checker, node) => {
    checker.declaredFieldsOf(node);
  },
  EnumDeclaration: (checker, node) => {
    checker.declaredVariantsOf(node);
  },
  ExternConstantDeclaration: (checker, node, module) => {
    checker.resolveType(module, node.type);
  },
  FunctionDeclaration: (checker, node) => {
    checker.parametersOf(node);
    checker.resultOf(node);
    checker.bodyOf(node);
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
