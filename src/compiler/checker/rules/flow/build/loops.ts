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
import type { Comprehension, FieldHeader, Spread } from '../../../../syntax/expressions/index.ts';
import type { For, LabelledScope } from '../../../../syntax/statements/index.ts';
import type { OverFields } from '../../../../syntax/statements/readings.ts';
import type { FieldPass } from '../../../surface/checked-body.ts';
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
    const call = {
      op: 'callValue',
      into: step,
      callee: cursor,
      arguments: [],
      spreads: [],
    } as const;
    builder.emit({ ...call, site: node });
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
 * Runs `pass` in each pass of the field loop `header` heads, read as that pass, in a scope of its
 * own, its header's targets bound (`fieldsBinding`); goes on past the loop. The field each pass
 * visits, none for one over the fields not known yet.
 */
export function fieldLoop(
  builder: FlowBuilder,
  node: OverFields,
  scope: LabelledScope | undefined,
  pass: () => void,
): readonly (string | undefined)[] {
  const { header } = node;
  const bind = header.kind === 'FieldHeader' ? fieldsBinding(builder, header) : undefined;
  const passes = builder.body.passesOf(header);
  const fields = passes.map(({ visits }) => (visits.kind === 'field' ? visits.name : undefined));
  loop(builder, scope, (top) => {
    const test = { kind: 'fieldPass', header, fields } as const;
    const [exit, ...starts] = builder.branch(test, passes.length + 1) as [BlockId, ...BlockId[]];
    return {
      exit,
      passes: () => {
        for (const [index, each] of passes.entries()) {
          builder.resumeIn(starts[index] as BlockId);
          builder.inView(each.body, () =>
            builder.scopes.inScope(node, () => {
              bind?.(each);
              pass();
            }),
          );
          builder.end({ kind: 'goto', to: top });
        }
      },
    };
  });
  return fields;
}

/**
 * How a pass over a value's fields binds `header`'s targets: to the pair of its key, the one value
 * of its key's type, the name of the field it visits, and that field's value, read from the
 * subject, which is read once, before the loop. A loop over a type's keys reads no value: its key
 * is a type, read where it is named as a value (expressions.ts).
 */
function fieldsBinding(builder: FlowBuilder, header: FieldHeader): (pass: FieldPass) => void {
  const subject = builder.expression(header.subject);
  return (each) => {
    const key = builder.compute(builder.temporary(header, each.key), header, { kind: 'typeValue' });
    const value = builder.temporary(header, each.value);
    const part = { kind: 'keyed', key } as const;
    builder.emit({ op: 'read', site: header, into: value, from: subject, part });
    const field = builder.temporary(header, tupleType([each.key, each.value]));
    const made = { kind: 'tuple' } as const;
    builder.emit({ op: 'make', site: header, into: field, made, parts: [key, value] });
    bindTargets(builder, header, field);
  };
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
