/**
 * The functions a body is checked in (§3.14): the body's own, and the lambdas and local `fn`s
 * nested in it, innermost last. One body checker checks them all, so their types and calls land
 * in one CheckedBody; what differs per function lives in its FunctionScope.
 *
 * - Each function has its own result, loops and asyncness: `return` leaves the innermost one,
 *   `break` can't reach a loop outside it, and `await` needs it to be async.
 * - Captures are found where names are used, from where they are declared: a nested function's
 *   text encloses every name it declares, so a variable declared outside a nested function is
 *   captured by it, and by every function between the two. A top-level name, of this module or
 *   another, is never captured; which names are top-level is the binder's to say (it gives them
 *   a module), so a local one is always in this body's own tree, where spans compare.
 * - A captured `let` is shared with the closure, so it lives in a cell (§3.14); anything else
 *   captured is copied, since it never changes. A reference can't be captured, as references are
 *   never stored (§3.7).
 * - The function a deferred call gives captures what its call computes now (§3.14), which is checked
 *   in the functions around the outermost deferred call the function is part of, where it runs.
 * - A nested function without a declared result, checked while its own name is used inside it,
 *   can't know its type: that is recursion needing a declared result (§2), as for top-level ones.
 */

import type { VariableEntity } from '../../../binder/entities.ts';
import { localFunctionOf } from '../../../binder/entities.ts';
import type { CallingNode } from '../../../syntax/expressions/calls.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import { encloses } from '../../../syntax/tree/positions.ts';
import type { BodyContext, FunctionFrame, Functions } from '../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../contexts/passes.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { handledBy } from '../../resolution/applying/call-kinds.ts';
import type {
  CheckedFunction,
  ComputedCapture,
  NestedFunction,
} from '../../surface/checked-body.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';

export class FunctionScopes implements Functions {
  #stack: FunctionFrame[];
  /** Nested functions being checked with no declared result, whose type isn't known yet. */
  readonly #untyped = new Set<NestedFunction>();
  readonly #checked: PassTable<NestedFunction, CheckedFunction>;

  constructor(root: FunctionFrame, passes: Passes) {
    this.#stack = [root];
    this.#checked = passes.table();
  }

  get current(): FunctionFrame {
    return this.#stack.at(-1) as FunctionFrame;
  }

  get frames(): readonly FunctionFrame[] {
    return [...this.#stack];
  }

  within<Result>(frames: readonly FunctionFrame[], check: () => Result): Result {
    const outer = this.#stack;
    this.#stack = [...frames];
    try {
      return check();
    } finally {
      this.#stack = outer;
    }
  }

  inside<Result>(scope: FunctionFrame, check: () => Result): Result {
    const untyped = scope.returns.declared === undefined ? scope.function : undefined;
    if (untyped !== undefined) {
      this.#untyped.add(untyped);
    }
    this.#stack.push(scope);
    try {
      return check();
    } finally {
      this.#stack.pop();
      if (untyped !== undefined) {
        this.#untyped.delete(untyped);
      }
    }
  }

  noteUse(context: BodyContext, name: Identifier, entity: VariableEntity): void {
    if (context.checker.bindings.isTopLevel(entity)) {
      return;
    }
    const declared = entity.name.span;
    const capturing = this.#stack.filter(
      ({ reach, captures }) =>
        reach !== undefined && !encloses(reach, declared) && !captures.has(entity.name),
    );
    // A nested function handles what it captures (proposal 8, Rule 2).
    const type = context.variables.typeOf(entity);
    for (const scope of capturing) {
      scope.capture(entity, name);
      handledBy(context.checker, scope, type);
    }
    if (capturing.length > 0) {
      capture(context, name, entity);
    }
  }

  computedNow<Result>(call: CallingNode, check: () => Result): Result {
    const later = this.current.makesLater;
    return later?.call === call ? this.within(later.now, check) : check();
  }

  captureNow(
    context: BodyContext,
    call: CallingNode,
    computed: () => readonly ComputedCapture[],
  ): void {
    const scope = this.current;
    if (scope.makesLater?.call !== call) {
      return;
    }
    for (const { site, type } of computed()) {
      scope.captureComputed(site, type);
      handledBy(context.checker, scope, type);
    }
  }

  makesLater(call: CallingNode): boolean {
    return this.current.makesLater?.call === call;
  }

  typeOfFunction(context: BodyContext, name: Identifier, entity: VariableEntity): Type {
    const owner = localFunctionOf(entity);
    if (owner !== undefined && this.#untyped.has(owner)) {
      context.report(checkerDiagnostics.recursiveReturnType(name.span, name.text));
      return errorType;
    }
    return context.variables.typeOf(entity);
  }

  record(node: NestedFunction, checked: CheckedFunction): void {
    this.#checked.set(node, checked);
  }

  checkedOf(node: NestedFunction, pass?: Pass): CheckedFunction | undefined {
    return this.#checked.get(node, pass);
  }
}

/** Notes what capturing `entity`, used where `name` is written, asks of it. */
function capture(context: BodyContext, name: Identifier, entity: VariableEntity): void {
  if (context.variables.isReference(entity)) {
    context.report(checkerDiagnostics.capturedReference(name.span, name.text));
  } else if (context.variables.isChangeable(entity)) {
    context.variables.noteCaptured(entity);
  }
}
