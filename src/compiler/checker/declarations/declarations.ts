/**
 * Checking a module's top-level declarations, one handler per kind: what each declares is
 * resolved, and every function body is checked. A module's diagnostics are complete once each of
 * its declarations has been through here.
 *
 * - A declaration's type parameters have their constraints resolved, and so does every member of
 *   a trait: its functions' signatures and its fields' types.
 * - An alias is resolved, which reports one that refers to itself (§3.17).
 * - The defaults of a struct's or a variant's fields are checked as the parameters they read as
 *   (§3.1).
 * - An extern a host implements takes and gives only what crosses as JSON (rules/host-boundary.ts),
 *   and so does `main`, whose outcome its host reads (§9).
 * - A `dispose` a program declares makes its type disposable, on its rules (rules/disposal.ts).
 * - Every item's annotations are checked where it stands (rules/annotations.ts): a function's, a
 *   field's and, of the rest, each declaration's, which none may carry. A function marked
 *   `@Suite` is held to what a suite function may be (rules/suites.ts).
 * - Imports declare nothing else to check.
 */

import { entryFunction } from '../../../language/well-known.ts';
import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import { isStdModule, type ModuleId } from '../../program/program.ts';
import type { Annotatable } from '../../syntax/annotations.ts';
import {
  type Declaration,
  type DeclaredStruct,
  type EnumDeclaration,
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import { fieldsFunctionOf } from '../../syntax/field-defaults.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { checkDisposeDeclaration, isDisposeFunction } from '../rules/disposal.ts';
import { checkHostBoundary, crossesToHost } from '../rules/host-boundary.ts';
import { checkSuite } from '../rules/suites.ts';
import type { GenericDeclaration } from '../types/resolve-type.ts';
import { futureArgument } from '../types/well-known.ts';
import { checkFiniteFields } from './struct-rules.ts';

/**
 * Resolves the constraints and defaults of `declaration`'s type parameters where they are written,
 * so what they misname, and what their defaults' arguments fail to meet, is reported there.
 */
function checkTypeParameters(checker: CheckerContext, declaration: GenericDeclaration): void {
  for (const parameter of typeParametersOf(declaration.typeParameters)) {
    if (parameter.isPack) {
      checkPack(checker, declaration, parameter);
    }
    checker.constraintsOf(parameter);
    if (parameter.defaultType !== undefined) {
      checker.resolveType(checker.moduleOf(declaration), parameter.defaultType);
    }
  }
}

/** Reports what a pack breaks of its rules: a function's, with no constraint or default (§3.5). */
function checkPack(
  checker: CheckerContext,
  declaration: GenericDeclaration,
  pack: TypeParameter,
): void {
  const module = checker.moduleOf(declaration);
  const { name } = pack;
  if (declaration.kind !== 'FunctionDeclaration') {
    checker.report(module, checkerDiagnostics.packOutsideFunction(name.span, name.text));
  }
  if (pack.constraints.length > 0) {
    checker.report(module, checkerDiagnostics.packConstrained(name.span, name.text, 'constraint'));
  }
  if (pack.defaultType !== undefined) {
    checker.report(module, checkerDiagnostics.packConstrained(name.span, name.text, 'default'));
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
  if (checker.annotations.suiteTitleOf(module, node) !== undefined) {
    checkSuite(checker, module, node);
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

/** What every struct declaration must keep, shared or not; a shared struct's values are handles, so they are finite. */
function checkStruct(checker: CheckerContext, node: DeclaredStruct, module: ModuleId): void {
  annotatedNowhere('a struct declaration')(checker, node, module);
  checkTypeParameters(checker, node);
  reportEndlessFields(checker, node, module);
  checker.annotations.checkFields(checker.declaredFieldsOf(node));
  checkFieldDefaults(checker, fieldsFunctionOf(node));
}

/** Reports each field of `node` that would make its instantiation endless (§3.5). */
function reportEndlessFields(
  checker: CheckerContext,
  node: DeclaredStruct | EnumDeclaration,
  module: ModuleId,
): void {
  for (const field of checker.endlessFieldsOf(node)) {
    checker.report(
      module,
      checkerDiagnostics.expandingType(field.name.span, node.name.text, field.name.text),
    );
  }
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
        refuseRequiredDefaults(checker, module, member);
      } else if (member.kind === 'FieldDeclaration') {
        const type = checker.resolveType(module, member.type);
        checker.annotations.of(module, member, { kind: 'field', type });
      }
    }
  },
  TypeAliasDeclaration: (checker, node, module) => {
    annotatedNowhere('a type alias')(checker, node, module);
    checkTypeParameters(checker, node);
    checker.aliasedType(node);
  },
  StructDeclaration: (checker, node, module) => {
    checkStruct(checker, node, module);
    checkFiniteFields(checker, node);
  },
  SharedStructDeclaration: checkStruct,
  EnumDeclaration: (checker, node, module) => {
    annotatedNowhere('an enum declaration')(checker, node, module);
    checkTypeParameters(checker, node);
    reportEndlessFields(checker, node, module);
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

/**
 * A trait's required function takes no defaults (§3.10): a call through it binds against its own
 * parameters, and the default each witness would give may differ.
 */
function refuseRequiredDefaults(
  checker: CheckerContext,
  module: ModuleId,
  required: FunctionDeclaration,
): void {
  for (const parameter of required.parameters) {
    if (parameter.kind === 'Parameter' && parameter.defaultValue !== undefined) {
      const { name } = parameter;
      checker.report(module, checkerDiagnostics.requiredDefault(name.span, name.text));
    }
  }
}

/** Checks `declaration`, a top-level item of `module`, reporting what it finds. */
export function checkDeclaration(
  checker: CheckerContext,
  module: ModuleId,
  declaration: Declaration,
): void {
  handlerOf(declarationHandlers, declaration)(checker, declaration, module);
}
