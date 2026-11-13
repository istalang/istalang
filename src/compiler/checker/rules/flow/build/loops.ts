/**
 * Loops (§3.10, §4), the way every iterating construct runs:
 *
 * - Over an iterable, through the cursor its `iterate` gives: the top calls the cursor and tests
 *   its step for `Next`, going on with the item it holds, or leaving past the loop on `Done`. A
 *   spread a literal copies whole runs no loop (literals.ts).
 * - Over a struct's fields: the subject once, then the top goes past the loop or to a pass of
 *   those `passesOf` gives, each read as checking checked that pass, with the header's key and value
 *   bound to the name of the field it visits and that field's value. Which comes next is left
 *   open: lowering runs each pass once per field it visits.
 *
 * A pass is a scope of its own; `break` leaves past the loop and `continue` goes to its top.
 */

import { stepVariants } from '../../../../../foundation/language/well-known/variants.ts';
import type { Comprehension, Spread } from '../../../../syntax/expressions/index.ts';
import type { For, LabelledScope } from '../../../../syntax/statements/index.ts';
import type { OverFields } from '../../../../syntax/statements/readings.ts';
import type { BlockId, ValueId } from '../../../surface/flow-ir.ts';
import { tupleType } from '../../../types/type/primitives.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall } from './implicit-calls.ts';
import { bindTargets, payload, readAlong } from './parts.ts';
import { variantTest } from './variants.ts';

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
  const cursor = implicitCall(builder, 'iterate', { site: node, passed: [iterable] });
  loop(builder, scope, (top) => {
    const { type } = builder.valueOf(cursor);
    const step = builder.temporary(node, type?.kind === 'function' ? type.result : undefined);
    builder.emit({ op: 'callValue', site: node, into: step, callee: cursor, arguments: [] });
    const test = variantTest(builder, step, stepVariants.next);
    const [next, done] = builder.branch(test) as [BlockId, BlockId];
    return {
      exit: done,
      passes: () => {
        builder.resumeIn(next);
        pass(readAlong(builder, step, [payload(form?.item)], node));
        builder.end({ kind: 'goto', to: top });
      },
    };
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
      builder.scopes.inScope(node, () => {
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
    const test = { kind: 'fieldPass', header } as const;
    const [exit, ...starts] = builder.branch(test, passes.length + 1) as [BlockId, ...BlockId[]];
    return {
      exit,
      passes: () => {
        for (const [index, each] of passes.entries()) {
          builder.resumeIn(starts[index] as BlockId);
          builder.inView(each.body, () =>
            builder.scopes.inScope(node, () => {
              const key = builder.temporary(header, each.key);
              builder.compute(key, header, { kind: 'fieldKey', header });
              const value = builder.temporary(header, each.value);
              const part = { kind: 'keyed', key } as const;
              builder.emit({ op: 'read', site: header, into: value, from: subject, part });
              const field = builder.temporary(header, tupleType([each.key, each.value]));
              const made = { kind: 'tuple' } as const;
              builder.emit({ op: 'make', site: header, into: field, made, parts: [key, value] });
              bindTargets(builder, header, field);
              pass();
            }),
          );
          builder.end({ kind: 'goto', to: top });
        }
      },
    };
  });
}

/** A loop's top, tested: where it goes past the loop, and how its passes are built from there. */
interface LoopTop {
  readonly exit: BlockId;
  readonly passes: () => void;
}

/**
 * A loop: its top, which `test` builds, testing whether to run a pass or go past the loop; `break`
 * goes past it, `continue` back to its top.
 */
function loop(
  builder: FlowBuilder,
  scope: LabelledScope | undefined,
  test: (top: BlockId) => LoopTop,
): void {
  const top = builder.newBlock();
  builder.continueIn(top);
  const { exit, passes } = test(top);
  if (scope === undefined) {
    passes();
  } else {
    builder.scopes.withExits(scope, exit, top, passes);
  }
  builder.resumeIn(exit);
}
