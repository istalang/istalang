/**
 * Checking a module's top-level declarations, one handler per kind: what each declares is
 * resolved, and every function body is checked. A module's diagnostics are complete once each of
 * its declarations has been through here.
 *
 * - A declaration's type parameters have their constraints resolved, and so does every member of
 *   a trait: its functions' signatures and its fields' types.
 * - An alias is resolved, which reports one that refers to itself (§3.17), and so is a struct's or
 *   an enum's associated type, an alias too (§3.1).
 * - The defaults of a struct's or a variant's fields are checked as the parameters they read as
 *   (§3.1).
 * - An extern a host implements takes and gives only what crosses as JSON
 *   (rules/boundary/host-boundary.ts), and so does `main`, whose outcome its host reads (§9).
 * - A `dispose` a program declares makes its type disposable, on its rules
 *   (rules/disposal/disposal.ts).
 * - Every item's annotations are checked where it stands (rules/annotations.ts): a function's, a
 *   field's and, of the rest, each declaration's, which none may carry. A function marked
 *   `@Suite` is held to what a suite function may be (rules/testing.ts).
 * - Imports declare nothing else to check.
 */

import { entryFunction } from '../../../../language/well-known/index.ts';
import { type Handlers, handlerOf } from '../../../../structures/kind-table.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { Annotatable } from '../../../syntax/annotations.ts';
import { fieldsFunctionOf } from '../../../syntax/declarations/field-defaults.ts';
import {
  type AliasDeclaration,
  type AssociatingDeclaration,
  type Declaration,
  type DeclaredStruct,
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import { parameterSite } from '../../../syntax/expressions/parameters.ts';
import type { NodeOf } from '../../../syntax/node.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { checkHostBoundary, crossesToHost } from '../../rules/boundary/host-boundary.ts';
import { checkDisposeDeclaration, isDisposeFunction } from '../../rules/disposal/disposal.ts';
import { checkSuite } from '../../rules/testing.ts';
import { namesMemberParameter } from '../../types/traits/struct-keys.ts';
import { futureArgument } from '../../types/type/well-known.ts';
import type { GenericDeclaration } from '../../types/written/type-arguments.ts';
import { checkFiniteAlias, checkFiniteFields } from './layout/struct-rules.ts';

/**
 * Resolves the constraints, unions and defaults of `declaration`'s type parameters where they are
 * written, so what they misname, and what their defaults' arguments fail to meet, is reported
 * there.
 */
function checkTypeParameters(checker: CheckerContext, declaration: GenericDeclaration): void {
  for (const parameter of typeParametersOf(declaration.typeParameters)) {
    if (parameter.isPack) {
      checkPack(checker, declaration, parameter);
    }
    checker.constraintsOf(parameter);
    checker.structConstraintsOf(parameter);
    checker.memberUnionOf(parameter);
    if (parameter.memberOf !== undefined && namesMemberParameter(checker, parameter)) {
      const module = checker.moduleOf(declaration);
      const { memberOf, name } = parameter;
      checker.report(module, checkerDiagnostics.memberOfMemberParameter(memberOf.span, name.text));
    }
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
    refusePatterns(checker, module, node, 'an extern function');
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
  if (node.name.text !== entryFunction || checker.isStd(module)) {
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

/**
 * What every struct declaration must keep, shared or not; a shared struct's values are handles, so
 * they are finite.
 */
function checkStruct(checker: CheckerContext, node: DeclaredStruct, module: ModuleId): void {
  annotatedNowhere('a struct declaration')(checker, node, module);
  checkTypeParameters(checker, node);
  checkAssociatedTypes(checker, node, module);
  checker.annotations.checkFields(checker.declaredFieldsOf(node));
  checkFieldDefaults(checker, fieldsFunctionOf(node));
}

/**
 * Resolves a struct's or an enum's associated types, which reports one referring to itself (§3.1).
 */
function checkAssociatedTypes(
  checker: CheckerContext,
  node: AssociatingDeclaration,
  module: ModuleId,
): void {
  for (const associated of node.associatedTypes) {
    annotatedNowhere('an associated type')(checker, associated, module);
    checkAlias(checker, associated);
  }
}

/**
 * Resolves what an alias or associated type stands for, which reports one referring to itself;
 * a type `match`'s subject, patterns and case types, and whether its reductions end (§3.17).
 */
function checkAlias(checker: CheckerContext, alias: AliasDeclaration): void {
  checker.aliasedType(alias);
  if (alias.kind === 'TypeAliasDeclaration') {
    checkFiniteAlias(checker, alias);
  }
  const { typeMatches } = checker;
  for (const { node } of typeMatches.typeMatchOf(alias)?.cases ?? []) {
    typeMatches.caseTypeOf(alias, node);
  }
  typeMatches.isEndless(alias);
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
        refusePatterns(checker, module, member, "a trait's requirement");
      } else if (member.kind === 'FieldDeclaration') {
        checker.resolveType(module, member.type);
        checker.annotations.of(module, member, { kind: 'field' });
      } else if (member.kind === 'RequiredAssociatedType') {
        annotatedNowhere('an associated type')(checker, member, module);
        checker.associatedBoundsOf(member);
      }
    }
  },
  TypeAliasDeclaration: (checker, node, module) => {
    annotatedNowhere('a type alias')(checker, node, module);
    checkTypeParameters(checker, node);
    checkAlias(checker, node);
  },
  StructDeclaration: (checker, node, module) => {
    checkStruct(checker, node, module);
    checkFiniteFields(checker, node);
  },
  SharedStructDeclaration: checkStruct,
  EnumDeclaration: (checker, node, module) => {
    annotatedNowhere('an enum declaration')(checker, node, module);
    checkTypeParameters(checker, node);
    checkAssociatedTypes(checker, node, module);
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
      const { span } = parameterSite(parameter);
      checker.report(module, checkerDiagnostics.requiredDefault(span, parameter.name?.text));
    }
  }
}

/**
 * A parameter's pattern binds names in its function's own body (§3.3): an extern function has
 * none, and a trait's requirement is a signature, whose default body, if any, is one of many a
 * witness could give, so both take their parameters by name.
 */
function refusePatterns(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
  what: string,
): void {
  for (const parameter of declaration.parameters) {
    if (parameter.kind === 'Parameter' && parameter.pattern !== undefined) {
      const { span } = parameter.pattern;
      checker.report(module, checkerDiagnostics.patternWithoutBody(span, what));
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
