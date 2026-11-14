/**
 * Who disposes a disposable value (§7). A type is disposable when a `dispose` takes it as `self`:
 * structural conformance to `Disposable` (§3.10), with no list kept anywhere else; whether a type
 * is reads what this finds (types/traits/disposable.ts). Only a value with an identity of its own
 * can be, so only a shared struct (§3.18) or an extern type, whose values are objects the runtime
 * keeps.
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
import {
  type Candidate,
  callCandidates,
  namedInModule,
} from '../../resolution/choosing/candidates.ts';
import { selfInference } from '../../resolution/choosing/receivers.ts';
import { checkedChildrenOf } from '../../surface/checked-body.ts';
import { isHostExtern, isHostType } from '../../surface/host-externs.ts';
import type { ResolvedCall } from '../../surface/resolved-call.ts';
import { sameType } from '../../types/identity/identity.ts';
import { substitute } from '../../types/parts/substitution.ts';
import { isConfined } from '../../types/properties/handles.ts';
import { isSimpleMark, kindOfFunction } from '../../types/type/function-kinds.ts';
import type { NominalType, Type } from '../../types/type/index.ts';
import { unitType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';

const none: Disposal = { kind: 'none' };

/** How `type`, whose `dispose` candidates are `found` (`disposeCandidates`), is disposed. */
export function disposalOf(
  checker: CheckerContext,
  type: NominalType,
  found: DisposeCandidates | undefined,
): Disposal {
  const call =
    found === undefined
      ? undefined
      : silentCall(checker, found.candidates, [{ type, passing: 'value' }]);
  if (found === undefined || call === undefined) {
    return none;
  }
  return { kind: found.runtime ? 'runtime' : 'function', call };
}

/**
 * The kinds of the `dispose` functions that may take `type` as `self`, of its candidates `found`,
 * each as `type` instantiates it, whatever its constraints (proposal 8, Rule 2): a type's kinds
 * are read from declarations, never from what meets a trait, which asks them (Rule 4).
 */
export function disposeKindsOf(
  checker: CheckerContext,
  type: NominalType,
  found: DisposeCandidates | undefined,
): readonly Type[] {
  return (found?.candidates ?? []).flatMap((candidate) => {
    const kind = kindOfFunction(checker, candidate.declaration);
    // An unmarked `dispose` adds no kind, whatever it takes.
    const taken = isSimpleMark(kind) ? undefined : selfInference(checker, candidate, type);
    return taken === undefined
      ? []
      : [substitute(kind, taken.inference.substitution(), checker.typeRules)];
  });
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

/** The `dispose` functions declared for a type, and whether they are the runtime's. */
export interface DisposeCandidates {
  readonly candidates: readonly Candidate[];
  readonly runtime: boolean;
}

/**
 * The `dispose` functions declared for `type`, found as an operator's function is: the runtime's
 * where a std module declares one beside it, else a program's for a handle a program may make
 * disposable; undefined for any other type.
 */
export function disposeCandidates(
  checker: CheckerContext,
  type: NominalType,
): DisposeCandidates | undefined {
  const runtime = isStdType(checker, type) && runtimeDisposes(checker, type);
  if (!(runtime || isOwnedHandle(checker, type))) {
    return undefined;
  }
  const candidates = callCandidates(checker, [], disposeFunction, [type]).filter(
    ({ requirement, declaration }) =>
      requirement === undefined &&
      (runtime ? isRuntimeDispose(checker, declaration) : isDisposeFunction(checker, declaration)),
  );
  return { candidates, runtime };
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
  if (declaration.isGetter) {
    checker.report(module, checkerDiagnostics.disposeGetter(at));
  }
  if (
    parameters.length !== 1 ||
    self === undefined ||
    self.reference ||
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

/**
 * Reports each use of `dispose`'s `self` other than `*self` or an argument of an extern call, in the
 * code as checked: what a deferred call computes now is kept in a constant its function captures.
 */
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
  /** Whether `self`, at `node` under `outer`, stays: dereferenced, or given to an extern call. */
  const stays = (node: SyntaxNode, outer: readonly SyntaxNode[]): boolean => {
    const [parent, ...around] = outer.filter((each) => each.kind !== 'Parenthesized');
    return (
      parent?.kind === 'Dereference' ||
      (parent?.kind === 'Call' && parent.callee !== node && isExternCall(parent)) ||
      (parent?.kind === 'MemberAccess' && isExternCall(callOfCallee(parent, around)))
    );
  };
  const visit = (node: SyntaxNode, outer: readonly SyntaxNode[], nested: boolean): void => {
    const entity = node.kind === 'Identifier' ? checker.bindings.entityOf(module, node) : undefined;
    // A parameter owns its pattern's names too (§3.3); only its own name is the disposed value.
    if (
      entity?.kind === 'variable' &&
      entity.name === self.name &&
      (nested || !stays(node, outer))
    ) {
      checker.report(module, checkerDiagnostics.disposeSelfEscapes(node.span, entity.name.text));
    }
    const inner = nested || nestsFunction(node);
    const children =
      body === undefined ? fieldChildrenOf(node) : checkedChildrenOf(node, body.coreOf);
    for (const child of [...children, ...bodyHeldApart(node)]) {
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
 * at one of `mockTargets`, where the body's mocks' targets are recorded (§7, §10).
 */
export function checkDisposeUses(
  context: BodyContext,
  calls: Iterable<readonly [NodeOf<string>, ResolvedCall]>,
  mockTargets: ReadonlySet<NodeOf<string>>,
): void {
  for (const [site, call] of calls) {
    if (call.function.name.text === disposeFunction && !mockTargets.has(site)) {
      context.report(checkerDiagnostics.disposeCall(site.span));
    }
  }
}
