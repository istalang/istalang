/**
 * Which values are disposable (§7), and who disposes them. A type is disposable when a `dispose`
 * takes it as `self`: structural conformance to `Disposable` (§3.10), with no list kept anywhere
 * else. Only a value with an identity of its own can be, so only a shared struct (§3.18) or an
 * extern type, whose values are objects the runtime keeps.
 *
 * - An extern `dispose` that a std module declares beside its type, as the prelude does for
 *   `Future` and `Slot`, is the runtime's to perform.
 * - Any other `dispose` runs as code, called with the value: `fn dispose(self: Lease)` makes a
 *   shared struct `Lease` disposable, and a host's extern type becomes disposable by a `dispose`
 *   declared beside it (§7). It is found the way an operator's function is, by argument-dependent
 *   lookup, so it lives beside the type it disposes (resolution/choosing/candidates.ts).
 * - A `dispose` that runs as code is plain code that can't wait, and `self` can't escape it: it is
 *   used only as `*self` (or `self->f`) or passed to an extern, so a disposed value never becomes
 *   observable again (§7).
 * - Only the runtime calls a `dispose`: code calls none and names none as a value, except as a
 *   test's mock target (§10), checked over a body's calls once it is checked.
 */

import { disposeFunction } from '../../../../foundation/language/well-known/implicit-calls.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { Parameter } from '../../../syntax/expressions/index.ts';
import { callOfCallee } from '../../../syntax/expressions/readings.ts';
import { awaits } from '../../../syntax/tokens/modifiers.ts';
import { fieldChildrenOf, nestsFunction, type SyntaxNode } from '../../../syntax/tree/index.ts';
import type { NodeOf } from '../../../syntax/tree/node.ts';
import type { Disposal } from '../../check.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { silentCall } from '../../resolution/applying/silent-choice.ts';
import { callCandidates, namedInModule } from '../../resolution/choosing/candidates.ts';
import { isHostExtern, isHostType } from '../../surface/host-externs.ts';
import type { FunctionCall, ResolvedCall, ResolvedSite } from '../../surface/resolved-call.ts';
import { sameType } from '../../types/identity/identity.ts';
import { isConfined } from '../../types/properties/handles.ts';
import { requiredFunctions } from '../../types/traits/constraints.ts';
import { knownConstraints } from '../../types/traits/known-constraints.ts';
import type { NominalType, Type } from '../../types/type/index.ts';
import { unitType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';

const none: Disposal = { kind: 'none' };

/**
 * Whether values of `type` are disposable: a handle with a `dispose`, or a type parameter or an
 * `any` type whose constraints require one, as `Disposable` does, so every type meeting them has
 * one (§3.10).
 */
export function isDisposable(checker: CheckerContext, type: Type): boolean {
  switch (type.kind) {
    case 'nominal':
      return checker.disposalOf(type).kind !== 'none';
    case 'parameter':
    case 'associated':
    case 'field':
    case 'any':
      return knownConstraints(checker, type).some(({ trait }) =>
        requiredFunctions(trait).some(({ name }) => name.text === disposeFunction),
      );
    case 'primitive':
    case 'literal':
    case 'union':
    case 'keys':
    case 'mapped':
    case 'match':
    case 'recursive':
    case 'anonymous':
    case 'tuple':
    case 'function':
    case 'error':
      return false;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

export function disposalOf(checker: CheckerContext, type: NominalType): Disposal {
  if (isStdType(checker, type) && runtimeDisposes(checker, type)) {
    return { kind: 'runtime' };
  }
  const call = isOwnedHandle(checker, type) ? declaredDispose(checker, type) : undefined;
  return call === undefined ? none : { kind: 'function', call };
}

/**
 * Whether `declaration`, a `dispose` a program declares, runs as code when its `self` is disposed.
 */
export function isDisposeFunction(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
): boolean {
  return (
    declaration.name.text === disposeFunction &&
    declaration.owner === undefined &&
    !isRuntimeDispose(checker, declaration)
  );
}

/**
 * Whether `declaration` is a `dispose` the runtime performs: an extern one a std module declares.
 */
function isRuntimeDispose(checker: CheckerContext, declaration: FunctionDeclaration): boolean {
  return declaration.isExtern && !isHostExtern(checker, declaration);
}

/**
 * Whether a program's `dispose` may make `type` disposable: a handle whose identity stays in its
 * instance or process (§3.6, §3.18), a shared struct or a host's. A std module's extern types are
 * either values, such as an `Array`, or disposed by the runtime already.
 */
function isOwnedHandle(checker: CheckerContext, type: NominalType): boolean {
  const { declaration } = type.entity;
  const runtimeImplements =
    declaration.kind === 'ExternStructDeclaration' && !isHostType(checker, type);
  return isConfined(declaration) && !runtimeImplements;
}

function isStdType(checker: CheckerContext, type: NominalType): boolean {
  return checker.isStd(checker.bindings.moduleOf(type.entity));
}

/** Whether `type`'s std module declares an extern `dispose` for it: the runtime's to perform. */
function runtimeDisposes(checker: CheckerContext, type: NominalType): boolean {
  const module = checker.bindings.moduleOf(type.entity);
  const overloads = module === undefined ? [] : namedInModule(checker, module, disposeFunction);
  return overloads.some((candidate) => {
    const [self] = checker.parametersOf(candidate);
    return (
      isRuntimeDispose(checker, candidate) &&
      self?.type.kind === 'nominal' &&
      self.type.entity === type.entity
    );
  });
}

/** The call of the `dispose` a program declares for `type`, found as an operator's function is. */
function declaredDispose(checker: CheckerContext, type: NominalType): FunctionCall | undefined {
  const candidates = callCandidates(checker, [], disposeFunction, [type]).filter(
    (candidate) =>
      candidate.requirement === undefined && isDisposeFunction(checker, candidate.declaration),
  );
  return silentCall(checker, candidates, [{ type, passing: 'value' }]);
}

/**
 * Checks a `dispose` a program declares (§7): its one parameter takes a handle a program may make
 * disposable, one whose identity stays in its instance or process, since a disposable value has an
 * identity of its own (§3.1, §3.6); it is plain code returning unit, lookup finds it for that
 * type, and its `self` never escapes it.
 */
export function checkDisposeDeclaration(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
): void {
  const module = checker.moduleOf(declaration);
  const at = declaration.name.span;
  const parameters = checker.parametersOf(declaration);
  const [self] = parameters;
  const returnsUnit = sameType(checker.resultOf(declaration), unitType);
  if (
    parameters.length !== 1 ||
    self?.reference === true ||
    awaits(declaration.qualifiers) ||
    !returnsUnit
  ) {
    checker.report(module, checkerDiagnostics.disposeSignature(at));
  }
  if (self === undefined || self.type.kind === 'error') {
    return;
  }
  if (self.type.kind !== 'nominal' || !isOwnedHandle(checker, self.type)) {
    // A host type a program may not make disposable is one whose identity would leave its instance.
    const misfit = isHostType(checker, self.type)
      ? checkerDiagnostics.unconfinedDisposable
      : checkerDiagnostics.disposeType;
    checker.report(module, misfit(at, typeText(self.type)));
    return;
  }
  const found = checker.disposalOf(self.type);
  if (found.kind !== 'function' || found.call.function !== declaration) {
    checker.report(module, checkerDiagnostics.disposeNotFound(at, typeText(self.type)));
  }
  checkSelfStays(checker, declaration, self.node);
}

/** Reports each use of `dispose`'s `self` other than `*self` or an argument of an extern call. */
function checkSelfStays(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
  self: Parameter,
): void {
  const module = checker.moduleOf(declaration);
  const body = checker.bodyOf(declaration);
  const isExternCall = (node: SyntaxNode | undefined): boolean =>
    node?.kind === 'Call' && body?.resolved.get(node)?.function.isExtern === true;
  // A local function's body is read as checking reads bodies, not through the tree.
  const bodyHeldApart = (node: SyntaxNode): readonly SyntaxNode[] => {
    const held =
      node.kind === 'FunctionDeclaration' ? checker.inputs.bodyOf(module, node) : undefined;
    return held === undefined ? [] : [held];
  };
  const visit = (node: SyntaxNode, outer: readonly SyntaxNode[], nested: boolean): void => {
    const entity = node.kind === 'Identifier' ? checker.bindings.entityOf(module, node) : undefined;
    // A parameter owns its pattern's names too (§3.3); only its own name is the disposed value.
    if (entity?.kind === 'variable' && entity.name === self.name) {
      const holders = outer.filter((each) => each.kind !== 'Parenthesized');
      const [parent] = holders;
      const stays =
        parent?.kind === 'Dereference' ||
        (parent?.kind === 'Call' && parent.callee !== node && isExternCall(parent)) ||
        (parent?.kind === 'MemberAccess' && isExternCall(callOfCallee(parent, holders.slice(1))));
      if (nested || !stays) {
        checker.report(module, checkerDiagnostics.disposeSelfEscapes(node.span, entity.name.text));
      }
    }
    const inner = nested || nestsFunction(node);
    for (const child of [...fieldChildrenOf(node), ...bodyHeldApart(node)]) {
      visit(child, [node, ...outer], inner);
    }
  };
  const root = checker.inputs.bodyOf(module, declaration);
  if (root !== undefined) {
    visit(root, [], false);
  }
}

/**
 * Reports each of `calls`, a checked body's, that calls `dispose` or names it as a value, except
 * as one of `mockTargets`, the targets of the body's mocks (§7, §10).
 */
export function checkDisposeUses(
  context: BodyContext,
  calls: Iterable<readonly [ResolvedSite, ResolvedCall]>,
  mockTargets: ReadonlySet<NodeOf<string>>,
): void {
  for (const [site, call] of calls) {
    if (call.function.name.text === disposeFunction && !mockTargets.has(site)) {
      context.report(checkerDiagnostics.disposeCall(site.span));
    }
  }
}
