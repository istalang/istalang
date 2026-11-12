/**
 * Loops (§3.10, §4), the way every iterating construct runs (lowering/constructs/loops/):
 *
 * - Over an iterable, through the cursor its `iterate` gives: each pass calls the cursor, and goes
 *   on with the item it gives, or leaves; a spread a literal copies whole is read whole instead.
 * - Over a struct's fields: the subject once, then a pass per field, each read as checking
 *   checked that pass (`passesOf`), with the header's key and value bound to the field's name and
 *   value. Which field comes next is left open: each pass may follow any, as a loop's would.
 *
 * A pass is a scope of its own; `break` leaves past the loop and `continue` goes to its top.
 */

import type { Comprehension, Spread } from '../../../../syntax/expressions/index.ts';
import type { For, LabelledScope } from '../../../../syntax/statements/index.ts';
import type { OverFields } from '../../../../syntax/statements/readings.ts';
import type { BlockId, ValueId } from '../flow-ir.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall } from './implicit-calls.ts';
import { bindTargets, constant } from './parts.ts';

/** A loop's passes: the scope its exits name, if any, and what each pass runs. */
interface Passes<Pass> {
  readonly scope?: LabelledScope | undefined;
  readonly pass: Pass;
}

/** A construct running over an iterable through a cursor. */
type Iterating = For | Comprehension | Spread;

/**
 * Runs `pass` once per item `node` runs over, `iterable`'s value, from the top of a loop whose
 * exits `scope` names, if any; goes on past the loop.
 */
export function itemLoop(
  builder: FlowBuilder,
  node: Iterating,
  iterable: ValueId,
  { scope, pass }: Passes<(item: ValueId) => void>,
): void {
  const form = builder.body.iterationOf(node);
  const isCopied = form?.kind === 'copied';
  const source = isCopied ? iterable : cursorOf(builder, node, iterable);
  loop(builder, scope, (top) => {
    const item = builder.temporary(node, form?.kind === 'cursor' ? form.item : undefined);
    if (isCopied) {
      builder.emit({ op: 'read', site: node, into: item, from: source, part: { kind: 'item' } });
    } else {
      const step = builder.temporary(node, undefined);
      builder.emit({ op: 'callValue', site: node, into: step, callee: source, arguments: [] });
      builder.emit({ op: 'read', site: node, into: item, from: step, part: { kind: 'item' } });
    }
    pass(item);
    builder.end({ kind: 'goto', to: top });
  });
}

/** Binds `node`'s targets to each item, in a scope of each pass's own, and runs `body`. */
export function targetsLoop(
  builder: FlowBuilder,
  node: For | Comprehension,
  scope: LabelledScope | undefined,
  body: () => void,
): void {
  const iterable = builder.expression(node.iterable);
  itemLoop(builder, node, iterable, {
    scope,
    pass: (item) =>
      builder.inScope(node, () => {
        bindTargets(builder, node, item);
        body();
      }),
  });
}

/**
 * Runs `pass` in each pass of the field loop `header` heads, read as that pass, its key and value
 * bound in a scope of its own; goes on past the loop.
 */
export function fieldLoop(
  builder: FlowBuilder,
  node: OverFields,
  scope: LabelledScope | undefined,
  pass: () => void,
): void {
  const { header } = node;
  const subject = builder.expression(header.subject);
  const passes = builder.body.passesOf(header);
  loop(builder, scope, (top) => {
    const [...starts] = builder.branch(passes.length);
    for (const [index, each] of passes.entries()) {
      builder.resumeIn(starts[index] as BlockId);
      builder.inView(each.body, () =>
        builder.inScope(node, () => {
          const key = constant(builder, header);
          const value = builder.temporary(header, each.value);
          builder.emit({
            op: 'read',
            site: header,
            into: value,
            from: subject,
            part: { kind: 'keyed' },
          });
          const field = builder.temporary(header, undefined);
          builder.emit({
            op: 'make',
            site: header,
            into: field,
            made: { kind: 'tuple' },
            parts: [key, value],
          });
          bindTargets(builder, header, field);
          pass();
        }),
      );
      builder.end({ kind: 'goto', to: top });
    }
  });
}

/** The cursor `node`'s `iterate` gives for `iterable`. */
function cursorOf(builder: FlowBuilder, node: Iterating, iterable: ValueId): ValueId {
  return implicitCall(builder, 'iterate', { site: node, passed: [iterable] });
}

/**
 * A loop: its top, which goes past the loop or into a pass that `body` builds from the top's
 * block; `break` goes past it, `continue` back to its top.
 */
function loop(
  builder: FlowBuilder,
  scope: LabelledScope | undefined,
  body: (top: BlockId) => void,
): void {
  const top = builder.newBlock();
  builder.continueIn(top);
  const [exit, pass] = builder.branch(2) as [BlockId, BlockId];
  builder.resumeIn(pass);
  if (scope === undefined) {
    body(top);
  } else {
    builder.withExits(scope, exit, top, () => body(top));
  }
  builder.resumeIn(exit);
}
