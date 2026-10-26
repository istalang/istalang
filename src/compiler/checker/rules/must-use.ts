/**
 * Values that must be used (§3.3, §3.12, §7): a value whose loss would go unnoticed can't be
 * left as a bare expression. It is awaited or matched, kept in a variable (`_` included) or
 * dropped.
 *
 * - A future must be used because its unawaited call would run on unseen, a `Result` because
 *   ignoring it ignores a failure, and any other disposable because it would be disposed at once.
 *   Any of them makes a value holding it must-use too, at any depth (types/held.ts): a `Result?`
 *   that `?.` gives, a tuple with a future in it.
 * - A statement's value is discarded unless it is its block's value, and a block run for its
 *   effects, like a loop's body, discards even its last.
 * - `drop e` discards `e` on purpose (§7), whatever it is. `drop x` on a variable also releases
 *   the variable, which then can't be used (rules/dropped.ts); only a variable this function holds
 *   itself can be: neither a capture, which belongs to the closure, nor a reference parameter,
 *   whose value is its caller's.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { VariableEntity } from '../../binder/entities.ts';
import { localFunctionOf } from '../../binder/entities.ts';
import type { NodeOf } from '../../syntax/node.ts';
import { type Drop, droppedName } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { heldType } from '../types/held.ts';
import { type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { futureArgument, wellKnownArguments } from '../types/well-known.ts';

/** How a must-use value is used, besides being kept or dropped. */
type Use = 'await' | 'match' | 'propagate' | 'hold';

/** What the message advises for each use, besides keeping or dropping the value. */
const advice: Readonly<Record<Use, string | undefined>> = {
  await: 'await it',
  match: 'match it',
  propagate: "match it, pass its Err on with '?'",
  hold: undefined,
};

/** Reports the statement `node` when the value it discards, of `type`, must be used. */
export function checkDiscarded(context: BodyContext, node: NodeOf<string>, type: Type): void {
  const use = mustUseAs(context, type);
  if (use !== undefined) {
    context.report(checkerDiagnostics.unusedValue(node.span, typeText(type), advice[use]));
  }
}

/** `drop e`: checks `e`, whose value is discarded on purpose; a variable must be droppable. */
export function checkDrop(context: BodyContext, node: Drop): Type {
  const name = droppedName(node);
  const entity = name === undefined ? undefined : context.entityOf(name);
  context.expression(node.value);
  if (name !== undefined && entity?.kind === 'variable') {
    const reason = undroppable(context, entity);
    if (reason !== undefined) {
      context.report(checkerDiagnostics.notDroppable(name.span, name.text, reason));
    }
  }
  return unitType;
}

/** Why `drop` can't release the variable `entity`; undefined when it can. */
function undroppable(context: BodyContext, entity: VariableEntity): string | undefined {
  if (localFunctionOf(entity) !== undefined) {
    return 'it names a function';
  }
  if (context.checker.bindings.moduleOf(entity) !== undefined) {
    return 'it is declared at the top level';
  }
  if (context.functions.current.captures.has(entity.name)) {
    return 'it is captured, so the closure holds it';
  }
  if (context.variables.isReference(entity)) {
    return "it is a reference parameter, whose value is its caller's";
  }
  return undefined;
}

/** How a value of `type` must be used; undefined when it may be lost. */
function mustUseAs(context: BodyContext, type: Type): Use | undefined {
  const { checker } = context;
  const isFuture = (part: Type) => futureArgument(checker, part) !== undefined;
  const isResult = (part: Type) =>
    wellKnownArguments(checker, wellKnown.result, part) !== undefined;
  const isDisposable = (part: Type) =>
    part.kind === 'nominal' && checker.disposalOf(part).kind !== 'none';
  const held = heldType(type, (part) => isFuture(part) || isResult(part) || isDisposable(part));
  if (held === undefined) {
    return undefined;
  }
  if (!(isFuture(held) || isResult(held))) {
    return 'hold';
  }
  if (held !== type) {
    // `await` and `?` take only the value itself, not a holder such as a `Result?` or a tuple.
    return 'match';
  }
  return isFuture(held) ? 'await' : 'propagate';
}
