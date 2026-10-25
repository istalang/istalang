/**
 * Which values are disposable (§7), and who disposes them. A type is disposable when a `dispose`
 * takes it as `self`: structural conformance to `Disposable` (§3.10), with no list kept anywhere
 * else. Only a value with an identity of its own can be, so only a handle: a `Shared`
 * instantiation, or an extern type, whose values are objects the runtime keeps.
 *
 * - An extern `dispose` that a std module declares beside its type, as the prelude does for
 *   `Future` and `Slot`, is the runtime's to perform.
 * - Any other `dispose` runs as code, called with a handle to the value: `fn dispose(self:
 *   Shared<Lease>)` makes every `Shared<Lease>` disposable, and a host's extern type becomes
 *   disposable by a `dispose` declared beside it (§7). It is found the way an operator's
 *   function is, by argument-dependent lookup, so it lives beside the type it disposes: a
 *   `Shared<T>`'s beside `T` (overloads/candidates.ts).
 * - A `dispose` that runs as code is plain code that can't wait, and `self` can't escape it: it is
 *   used only as `self$` or passed to an extern, so a disposed value never becomes observable
 *   again (§7).
 */

import { disposeFunction, wellKnown } from '../../../language/well-known.ts';
import { isStdModule } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Parameter } from '../../syntax/expressions.ts';
import { childrenOf, type SyntaxNode } from '../../syntax/tree.ts';
import type { Disposal, FunctionCall } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { callMade } from '../overloads/calls-made.ts';
import { callCandidates } from '../overloads/candidates.ts';
import { chooseSilently } from '../overloads/silent-choice.ts';
import { type NominalType, sameType, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownArguments } from '../types/well-known.ts';
import { silent, useSite } from '../use-site.ts';
import { isHostExtern } from './host-boundary.ts';

const none: Disposal = { kind: 'none' };

export function disposalOf(checker: CheckerContext, type: NominalType): Disposal {
  if (type.entity.declaration.kind !== 'ExternStructDeclaration') {
    return none;
  }
  if (isStdType(checker, type) && runtimeDisposes(checker, type)) {
    return { kind: 'runtime' };
  }
  const call = isOwnedHandle(checker, type) ? declaredDispose(checker, type) : undefined;
  return call === undefined ? none : { kind: 'function', call };
}

/** Whether `declaration`, a `dispose` a program declares, runs as code when its `self` is disposed. */
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

/** Whether `declaration` is a `dispose` the runtime performs: an extern one a std module declares. */
function isRuntimeDispose(checker: CheckerContext, declaration: FunctionDeclaration): boolean {
  return declaration.isExtern && !isHostExtern(checker, declaration);
}

/**
 * Whether a program's `dispose` may make `type` disposable: a handle no std module disposes, a
 * `Shared` instantiation or an extern type a host provides. A std module's other extern types are
 * either values, such as an `Array`, or disposed by the runtime already.
 */
export function isOwnedHandle(checker: CheckerContext, type: NominalType): boolean {
  if (type.entity.declaration.kind !== 'ExternStructDeclaration') {
    return false;
  }
  return (
    wellKnownArguments(checker, wellKnown.shared, type) !== undefined || !isStdType(checker, type)
  );
}

function isStdType(checker: CheckerContext, type: NominalType): boolean {
  return isStdModule(checker.program, checker.bindings.moduleOf(type.entity));
}

/** Whether `type`'s std module declares an extern `dispose` for it: the runtime's to perform. */
function runtimeDisposes(checker: CheckerContext, type: NominalType): boolean {
  const module = checker.bindings.moduleOf(type.entity);
  const declared =
    module === undefined ? undefined : checker.bindings.exportsOf(module).get(disposeFunction);
  return (
    declared?.kind === 'functions' &&
    declared.overloads.some((candidate) => {
      const [self] = checker.parametersOf(candidate);
      return (
        isRuntimeDispose(checker, candidate) &&
        self?.type.kind === 'nominal' &&
        self.type.entity === type.entity
      );
    })
  );
}

/** The call of the `dispose` a program declares for `type`, found as an operator's function is. */
function declaredDispose(checker: CheckerContext, type: NominalType): FunctionCall | undefined {
  const candidates = callCandidates(checker, [], disposeFunction, [type]).filter(
    (candidate) =>
      candidate.requirement === undefined && isDisposeFunction(checker, candidate.declaration),
  );
  const { declaration } = type.entity;
  const site = silent(useSite(checker, checker.moduleOf(declaration), declaration.name.span));
  const chosen = chooseSilently(site, candidates, [{ type, passing: 'value' }]);
  const call =
    chosen === undefined
      ? undefined
      : callMade(chosen.application.candidate, chosen.instantiation, 1);
  return call?.kind === 'function' ? call : undefined;
}

/**
 * Checks a `dispose` a program declares (§7): its one parameter takes a handle a program may make
 * disposable, and a host type that isn't declared sendable, since a disposable value has an identity
 * of its own (§3.1); it is plain code returning unit, lookup finds it for that type, and its `self`
 * never escapes it.
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
  if (parameters.length !== 1 || self?.reference === true || declaration.isAsync || !returnsUnit) {
    checker.report(module, checkerDiagnostics.disposeSignature(at));
  }
  if (self === undefined || self.type.kind === 'error') {
    return;
  }
  if (self.type.kind !== 'nominal' || !isOwnedHandle(checker, self.type)) {
    checker.report(module, checkerDiagnostics.disposeType(at, typeText(self.type)));
    return;
  }
  const { declaration: disposed } = self.type.entity;
  if (disposed.kind === 'ExternStructDeclaration' && disposed.isSendable) {
    checker.report(module, checkerDiagnostics.disposableSendable(at, typeText(self.type)));
  }
  const found = checker.disposalOf(self.type);
  if (found.kind !== 'function' || found.call.function !== declaration) {
    checker.report(module, checkerDiagnostics.disposeNotFound(at, typeText(self.type)));
  }
  checkSelfStays(checker, declaration, self.node);
}

/** Reports each use of `dispose`'s `self` other than `self$` or an argument of an extern call. */
function checkSelfStays(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
  self: Parameter,
): void {
  const module = checker.moduleOf(declaration);
  const body = checker.bodyOf(declaration);
  const isExternCall = (node: SyntaxNode | undefined): boolean =>
    node?.kind === 'Call' && body?.calls.get(node)?.function.isExtern === true;
  const visit = (node: SyntaxNode, outer: readonly SyntaxNode[], nested: boolean): void => {
    const entity = node.kind === 'Identifier' ? checker.bindings.entityOf(module, node) : undefined;
    if (entity?.kind === 'variable' && entity.owner === self) {
      const [parent, grandparent] = outer.filter((each) => each.kind !== 'Parenthesized');
      const stays =
        parent?.kind === 'Unwrap' ||
        (parent?.kind === 'Call' && parent.callee !== node && isExternCall(parent)) ||
        (parent?.kind === 'MemberAccess' && isExternCall(grandparent));
      if (nested || !stays) {
        checker.report(module, checkerDiagnostics.disposeSelfEscapes(node.span, self.name.text));
      }
    }
    const inner = nested || node.kind === 'Lambda' || node.kind === 'FunctionDeclaration';
    for (const child of childrenOf(node)) {
      visit(child, [node, ...outer], inner);
    }
  };
  if (declaration.body !== undefined) {
    visit(declaration.body, [], false);
  }
}
