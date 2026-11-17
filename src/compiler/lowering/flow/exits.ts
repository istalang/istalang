/**
 * How each block of a flow ends, as the instructions it is (writer.ts), and what each branch tests:
 *
 * - `goto` jumps, unless its target is written next; to a field loop's top, it goes on to the next
 *   pass (layout.ts). `return` returns, or gives the root's value where the flow is written inline.
 * - `condition` is a `branch`; `present` tests an optional for `none` by its layout
 *   (values/optionals.ts); `is` tests a variant, an `any`'s held type, or a union's members
 *   (values/members/tests.ts), an instantiation having merged a literal member into its base
 *   compared with that literal.
 * - A field loop's top goes to its first pass; a `select` goes to the case its wait was decided
 *   for (flow-waits.ts), or to its `else` alone where it has no case.
 * - `transient` is the instruction sharing a transient's cell from a call this one is nested in,
 *   going on to its initializer where none shares one (§3.4).
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { TypeTest } from '../../checker/surface/checked-pattern.ts';
import type { BlockId, BranchTest, Exit } from '../../checker/surface/flow-ir.ts';
import { unitType } from '../../checker/types/type/primitives.ts';
import type { TypedValue } from '../context.ts';
import type { Label } from '../functions/code-writer.ts';
import { type Branch, branchOnMembers } from '../values/members/tests.ts';
import { branchOnPresent } from '../values/optionals.ts';
import { branchOnVariant } from '../values/variant-values.ts';
import { selected } from './flow-waits.ts';
import type { FlowWriter } from './writer.ts';

type ExitOf<Kind extends Exit['kind']> = Extract<Exit, { readonly kind: Kind }>;
type TestOf<Kind extends BranchTest['kind']> = Extract<BranchTest, { readonly kind: Kind }>;

/** Where a branch goes: its blocks' labels, at least the two a test goes to. */
type Targets = readonly [Label, Label, ...Label[]];

export const exitWriters: {
  readonly [Kind in Exit['kind']]: (writer: FlowWriter, exit: ExitOf<Kind>) => void;
} = {
  goto: (writer, { to }) => writer.goTo(to, writer.flow.root.span),
  branch: (writer, { test, to }) =>
    (
      testWriters[test.kind] as (
        writer: FlowWriter,
        test: BranchTest,
        to: readonly BlockId[],
      ) => void
    )(writer, test, to),
  return: (writer, { value, site }) => {
    const { context } = writer;
    const { code } = context;
    const { span } = site;
    const register =
      value === undefined ? context.constant(null, unitType, span) : writer.registerOf(value);
    if (writer.end.kind !== 'return' && site === writer.flow.root) {
      code.emit({ kind: 'move', span, dst: writer.end.into, src: code.take(register, span) });
      writer.leave(span);
    } else {
      code.return(register, span);
    }
  },
  stop: (writer) => writer.context.code.emit({ kind: 'unreachable', span: writer.flow.root.span }),
};

const testWriters: {
  readonly [Kind in BranchTest['kind']]: (
    writer: FlowWriter,
    test: TestOf<Kind>,
    to: readonly BlockId[],
  ) => void;
} = {
  condition: (writer, { value }, to) => {
    const [whenTrue, whenFalse] = labelsOf(writer, to);
    writer.context.code.branch(
      writer.registerOf(value),
      whenTrue,
      whenFalse,
      writer.flow.root.span,
    );
  },
  present: (writer, { value }, to) => {
    const [present, none] = labelsOf(writer, to);
    branchOnPresent(writer.context, writer.typed(value), { present, none }, writer.flow.root.span);
  },
  is: (writer, { value, test }, to) => {
    const [holds, fails] = labelsOf(writer, to);
    branchOnType(writer, writer.typed(value), test, { matched: holds, otherwise: fails });
  },
  fieldPass: (writer) => writer.goTo(writer.firstPass(), writer.flow.root.span),
  select: selected,
  transient: (writer, { variable }, to) => {
    const [shared, unmade] = to as [BlockId, BlockId];
    const { span } = writer.flow.root;
    writer.context.code.transient(writer.registerOf(variable), writer.labelOf(shared), span);
    writer.goTo(unmade, span);
  },
  unknown: ({ flow }) =>
    unreachable(`A test checking found a mistake in at ${flow.root.span.from} is lowered.`),
};

function labelsOf(writer: FlowWriter, to: readonly BlockId[]): Targets {
  return to.map((block) => writer.labelOf(block)) as unknown as Targets;
}

/** Jumps as `test` finds `value`: by its variant, an `any`'s held type, or a union's member. */
function branchOnType(writer: FlowWriter, value: TypedValue, test: TypeTest, branch: Branch): void {
  const { context } = writer;
  const { span } = writer.flow.root;
  if (test.kind === 'member') {
    const tested = { register: value.register, type: test.union };
    branchOnMembers(context, { value: tested, members: test.members }, branch, span);
    return;
  }
  const variant =
    test.kind === 'variant' ? test.variant : context.tables.types.anyVariant(test.from, test.to);
  branchOnVariant(context, { register: value.register, variant }, branch, span);
}
