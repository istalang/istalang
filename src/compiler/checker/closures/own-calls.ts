/**
 * An async function's own name before a `.` (§7): the handle of the enclosing call of that
 * function, a `_Call`, whose members are the prelude's like any type's, so `worker.disposing()` is
 * an ordinary method call on it.
 *
 * - A function's name has no members of its own, so a link's target that names functions is read
 *   this way (optionals.ts, the one place a link's target is checked). It denotes the enclosing
 *   function it names: a top-level `fn` of the body's own overloads, or a local `fn` or named
 *   lambda the body nests.
 * - `main` is refused: nothing holds its call, so it is never disposed.
 * - The handle is a hidden variable of the function, which lowering fills at its entry
 *   (`currentCall`). It is declared where the function's name is, so a function nested in it
 *   captures it like any variable (functions.ts), and a closure watches the call it was made in,
 *   wherever it runs.
 */

import { entryFunction, wellKnown } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Entity, VariableEntity } from '../../binder/entities.ts';
import { localFunctionOf } from '../../binder/entities.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { NestedFunction } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { errorType, type Type } from '../types/type.ts';

/** The hidden variables holding the calls a body reads, and the variable each read names. */
export class OwnCalls {
  readonly #variables = new Map<NestedFunction, VariableEntity>();
  readonly #reads = new Map<Expression, VariableEntity>();

  /** The variable holding the handle of the call the name `node` reads; undefined for any other node. */
  readAt(node: Expression): VariableEntity | undefined {
    return this.#reads.get(node);
  }

  /** The variable `owner`'s entry takes its call's handle into, when anything reads it. */
  variableOf(owner: NestedFunction): VariableEntity | undefined {
    return this.#variables.get(owner);
  }

  /** Records that `name` reads `owner`'s call, typed `type`; that call's variable. */
  record(
    context: BodyContext,
    name: Identifier,
    owner: NestedFunction,
    type: Type,
  ): VariableEntity {
    let variable = this.#variables.get(owner);
    if (variable === undefined) {
      const declared = owner.name;
      if (declared === undefined) {
        unreachable('Only a named function has a call its name reads.');
      }
      const hidden: Identifier = { kind: 'Identifier', span: declared.span, text: declared.text };
      variable = { kind: 'variable', name: hidden, owner };
      context.variables.declare(hidden, type);
      this.#variables.set(owner, variable);
    }
    this.#reads.set(name, variable);
    return variable;
  }
}

/**
 * The type of the link target `target` when it names functions: the enclosing call's handle, or
 * the error type after a report; undefined for any other target, which is checked as a value.
 */
export function checkOwnCall(context: BodyContext, target: Expression): Type | undefined {
  if (target.kind !== 'Identifier') {
    return undefined;
  }
  const entity = context.checker.bindings.entityOf(context.module, target);
  const functions = functionsNamed(entity);
  if (functions === undefined) {
    return undefined;
  }
  if (entity?.kind === 'functions' && target.text === entryFunction) {
    context.report(checkerDiagnostics.mainNeverDisposed(target.span));
    return errorType;
  }
  const scope = context.functions.enclosing(functions);
  if (scope?.function === undefined || !scope.isAsync) {
    context.report(checkerDiagnostics.notOwnCall(target.span, target.text));
    return errorType;
  }
  const handle = context.checker.wellKnownType(wellKnown.call);
  if (handle === undefined) {
    return errorType;
  }
  const variable = context.ownCalls.record(context, target, scope.function, handle);
  context.functions.noteUse(context, variable.name, variable);
  return handle;
}

/**
 * The functions `entity` names, if it names functions: a top-level overload set, or a local `fn`
 * or named lambda by its own name.
 */
function functionsNamed(entity: Entity | undefined): readonly NestedFunction[] | undefined {
  switch (entity?.kind) {
    case 'functions':
      return entity.overloads;
    case 'variable': {
      const local = localFunctionOf(entity);
      return local === undefined ? undefined : [local];
    }
    default:
      return undefined;
  }
}
