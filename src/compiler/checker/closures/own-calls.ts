/**
 * `worker.disposing()` (§7): the future of an enclosing async call's disposal, which an async
 * function's own name gives.
 *
 * - The name is resolved like any other, so `worker` is the enclosing function it denotes: a
 *   top-level `fn` of the body's own overloads, or a local `fn` or named lambda the body nests.
 * - `main` is refused: nothing holds its call, so it is never disposed.
 * - The call's handle is a hidden variable of the function, which lowering fills at its entry
 *   (`currentCall`). It is declared where the function's name is, so a function nested in it
 *   captures it like any variable (functions.ts), and a closure watches the call it was made in,
 *   wherever it runs.
 * - The watch is a call to the prelude's private `_disposing`, recorded at the site like any call,
 *   with the handle as its argument.
 */

import { entryFunction, ownCall, wellKnown } from '../../../language/well-known.ts';
import type { Entity, VariableEntity } from '../../binder/entities.ts';
import type { Call } from '../../syntax/expressions.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { callMade } from '../overloads/calls-made.ts';
import { errorType, type Type, unitType } from '../types/type.ts';
import { localFunctionOf, type NestedFunction } from './function-scope.ts';

/** The hidden variables holding the calls a body watches, and the variable each watch reads. */
export class OwnCalls {
  readonly #variables = new Map<NestedFunction, VariableEntity>();
  readonly #watches = new Map<Call, VariableEntity>();

  /** The variable holding the handle of the call the `worker.disposing()` at `site` watches. */
  watchedAt(site: Call): VariableEntity | undefined {
    return this.#watches.get(site);
  }

  /** The variable `owner`'s entry takes its call's handle into, when anything watches it. */
  variableOf(owner: NestedFunction): VariableEntity | undefined {
    return this.#variables.get(owner);
  }

  /** Records that the watch at `site` reads `owner`'s call, typed `type`; that call's variable. */
  record(context: BodyContext, site: Call, owner: NestedFunction, type: Type): VariableEntity {
    let variable = this.#variables.get(owner);
    if (variable === undefined) {
      const { name } = owner;
      if (name === undefined) {
        throw new Error('Only a named function has a call its name watches.');
      }
      const hidden: Identifier = { kind: 'Identifier', span: name.span, text: name.text };
      variable = { kind: 'variable', name: hidden, owner };
      context.variables.declare(hidden, type);
      this.#variables.set(owner, variable);
    }
    this.#watches.set(site, variable);
    return variable;
  }
}

/**
 * Checks `name.disposing()` at `node` when `name` denotes a function; undefined when it denotes
 * anything else, whose `disposing` is an ordinary method.
 */
export function checkOwnCall(context: BodyContext, node: Call, name: Identifier): Type | undefined {
  const entity = context.checker.bindings.entityOf(context.module, name);
  const functions = functionsNamed(entity);
  if (functions === undefined) {
    return undefined;
  }
  if (node.arguments.length > 0) {
    const method = `${name.text}.${ownCall.method}`;
    context.report(checkerDiagnostics.argumentCount(node.span, method, 0, node.arguments.length));
    return errorType;
  }
  if (entity?.kind === 'functions' && name.text === entryFunction) {
    context.report(checkerDiagnostics.mainNeverDisposed(node.span));
    return errorType;
  }
  const scope = context.functions.enclosing(functions);
  if (scope?.function === undefined || !scope.isAsync) {
    context.report(checkerDiagnostics.notOwnCall(node.span, name.text));
    return errorType;
  }
  const { checker } = context;
  const [watch] = checker.languageFunctions('prelude', ownCall.watch);
  const future = checker.wellKnownType(wellKnown.future, [unitType]);
  const handle = checker.wellKnownType(wellKnown.call);
  const plain = { typeArguments: [], witnesses: new Map() };
  const call = watch === undefined ? undefined : callMade({ declaration: watch }, plain, 0);
  if (call === undefined || future === undefined || handle === undefined) {
    return errorType;
  }
  const variable = context.ownCalls.record(context, node, scope.function, handle);
  context.functions.noteUse(context, variable.name, variable);
  context.recordCall(node, call);
  return future;
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
