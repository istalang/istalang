/**
 * How each block of a flow ends, as the instructions it is (writer.ts), and what each branch tests:
 *
 * - `goto` jumps, unless its target is written next; to a field loop's top, it goes on to the next
 *   pass (layout.ts). `return` returns, or gives the root's value where the flow is written inline.
 * - `condition` is a `branch`; `present` tests an optional for `none` by its layout
 *   (values/optionals.ts); `is` tests a variant, an `any`'s held type, or a union's members
 *   (values/holdings.ts), an instantiation having merged a literal member into its base compared
 *   with that literal.
 * - A field loop's top goes to its first pass; a `select` is the instruction choosing among its
 *   cases, each holding what its awaitable computed, its binding given what its future gave, or to
 *   its `else` alone where it has no case.
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { TypeTest } from '../../checker/surface/checked-pattern.ts';
import type { BlockId, BranchTest, Exit } from '../../checker/surface/flow-ir.ts';
import { sameType } from '../../checker/types/identity/identity.ts';
import type { LiteralType, Type } from '../../checker/types/type/index.ts';
import { baseOf } from '../../checker/types/unions/union-members.ts';
import { hasMember } from '../../checker/types/unions/unions.ts';
import { selectCasesOf } from '../../syntax/expressions/readings.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { Label } from '../functions/code-writer.ts';
import { emitConstant } from '../tables/constants.ts';
import { branchOnHeld, laidOutAs, type TypedValue } from '../values/holdings.ts';
import { equal } from '../values/operators.ts';
import { branchOnPresent } from '../values/optionals.ts';
import { outOfUnion } from '../values/unions.ts';
import { branchOnVariant } from '../values/variant-values.ts';
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
    const { code } = writer.context;
    const { span } = site;
    const register = value === undefined ? code.allocate() : writer.registerOf(value);
    if (writer.end.kind === 'into' && site === writer.flow.root) {
      code.emit({ kind: 'move', span, dst: writer.end.into, src: register });
      writer.leave(span);
    } else {
      code.emit({ kind: 'return', span, value: register });
    }
  },
  stop: () => undefined,
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
  select: (writer, { node, holds }, to) => {
    const { code } = writer.context;
    const targets = labelsOf(writer, to);
    const cases = selectCasesOf(node);
    if (cases.length === 0) {
      writer.goTo(to[0] ?? unreachable('A select goes nowhere.'), node.span);
      return;
    }
    const wait = writer.takeWait();
    const written = cases.map((selectCase, index) => {
      const bind = selectCase.binding === undefined ? undefined : code.allocate();
      const future = wait.futures[index];
      if (bind !== undefined && future !== undefined) {
        writer.give(future, bind);
      }
      const held = writer.registersEnding(holds[index] ?? []);
      return { holds: held, bind, target: targets[index] as Label };
    });
    const otherwise = node.elseClause === undefined ? undefined : targets[cases.length];
    code.withWaypoint(writer.waypointAt(node), () =>
      code.select(wait.wait, written, otherwise, node.span),
    );
  },
  unknown: ({ flow }) =>
    unreachable(`A test checking found a mistake in at ${flow.root.span.from} is lowered.`),
};

function labelsOf(writer: FlowWriter, to: readonly BlockId[]): Targets {
  return to.map((block) => writer.labelOf(block)) as unknown as Targets;
}

/** Where a type test goes: to `matched` where the value holds what it tests, else `otherwise`. */
interface Branch {
  readonly matched: Label;
  readonly otherwise: Label;
}

/** Jumps as `test` finds `value`: by its variant, an `any`'s held type, or a union's member. */
function branchOnType(writer: FlowWriter, value: TypedValue, test: TypeTest, branch: Branch): void {
  const { context } = writer;
  const { span } = writer.flow.root;
  if (test.kind === 'member') {
    const tested = { register: value.register, type: test.union };
    branchOnMembers(writer, { tested, members: test.members }, branch, span);
    return;
  }
  const variant =
    test.kind === 'variant' ? test.variant : context.tables.types.anyVariant(test.from, test.to);
  branchOnVariant(context, { register: value.register, variant }, branch, span);
}

/**
 * A member test: a `switch` on the variants holding the members (values/holdings.ts). An
 * instantiation may have collapsed the union (§3.5): into one type, which a member of that type
 * passes and no other; a literal member into its base, whose value is then compared with the
 * literal; or a member into the `any` type that took it whole, whose variant is tested.
 */
function branchOnMembers(
  writer: FlowWriter,
  { tested, members }: { readonly tested: TypedValue; readonly members: readonly Type[] },
  { matched, otherwise }: Branch,
  span: AnchoredSpan,
): void {
  const { context } = writer;
  const { code } = context;
  const union = laidOutAs(tested.type);
  const value = { register: tested.register, type: union };
  const isOwn = (member: Type) =>
    union.kind === 'union' ? hasMember(union, member) : sameType(union, member);
  const merged = members.filter(
    (member): member is LiteralType => member.kind === 'literal' && !isOwn(member),
  );
  const held = members.filter((member) => !merged.includes(member as LiteralType));
  let next = merged.length === 0 ? otherwise : code.newLabel();
  branchOnHeld(context, { value, members: held }, { matched, otherwise: next }, span);
  for (const [index, literal] of merged.entries()) {
    code.place(next);
    next = index === merged.length - 1 ? otherwise : code.newLabel();
    const holdsBase = code.newLabel();
    const base = baseOf(literal);
    branchOnHeld(
      context,
      { value, members: [base] },
      { matched: holdsBase, otherwise: next },
      span,
    );
    code.place(holdsBase);
    const inside = outOfUnion(context, value, base, span);
    const constant = emitConstant(context, literal.value, span);
    code.branch(equal(context, span, [inside, constant]), matched, next, span);
  }
}
