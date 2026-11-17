/**
 * The waits of a flow (§6, §8), written through the prelude's waiting (calls/waits.ts): the one
 * place a flow's `await`s and `select`s are lowered.
 *
 * - **A wait is its `await` or `select`,** which the flow names with the futures its cases wait
 *   on, in case order: an `await`'s `suspend`, a `select`'s test. Each case's `onAwait` is handed
 *   the resolver of its own position, and the first written opens the wait, so no case's position
 *   or wait depends on the order lowering meets them.
 * - **An `await` parks** until its one case decides its wait; a `select` parks, or with an `else`
 *   asks at once whether a case has (`decidedAt`), then goes to the case decided, which takes what
 *   its future gave and lets go of the wait and of the losing cases' holdings, its own moving to
 *   the scope around the `select` (spec amendment, "select losers").
 * - Once decided, each future its case waited on gives its value into a register of its own.
 */

import type { Register } from '../../../definition/operands.ts';
import { type Persistence, wellKnown } from '../../../foundation/language/well-known/index.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type {
  BlockId,
  BranchTest,
  FlowFunction,
  Operation,
  ValueId,
} from '../../checker/surface/flow-ir.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { intType } from '../../checker/types/type/primitives.ts';
import { wellKnownArguments } from '../../checker/types/type/well-known.ts';
import { selectCasesOf } from '../../syntax/expressions/readings.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { type ClosedCall, calledParameters, substitutionOfCall } from '../calls/closed-calls.ts';
import {
  caseResolver,
  caseValue,
  decidedAt,
  type OpenWait,
  openWait,
  parked,
  waitRegisters,
} from '../calls/waits.ts';
import { waypointAt } from './waypoints.ts';
import type { FlowWriter } from './writer.ts';

/**
 * Where the flow waits: an `await`'s `suspend` or a `select`'s test. Not their syntax node, which
 * a field loop writes once per field (§3.16), each copy a wait of its own.
 */
type WaitSite =
  | Extract<Operation, { readonly op: 'suspend' }>
  | Extract<BranchTest, { readonly kind: 'select' }>;

/** A wait of the flow: where it waits, and its cases' futures, in order. */
interface FlowWait {
  readonly site: WaitSite;
  readonly futures: readonly ValueId[];
}

/** The wait a future is a case of, and the case's position in it. */
interface WaitedIn {
  readonly wait: FlowWait;
  readonly position: number;
}

export class FlowWaits {
  readonly #waits = new Map<WaitSite, FlowWait>();
  readonly #cases = new Map<ValueId, WaitedIn>();
  readonly #opened = new Map<FlowWait, OpenWait>();
  /** What each future gave once it settled, in the register owning it. */
  readonly #given = new Map<ValueId, Register>();

  constructor(flow: FlowFunction) {
    for (const { operations, exit } of flow.blocks) {
      for (const operation of operations) {
        if (operation.op === 'suspend' && operation.site.kind === 'Await') {
          this.#add({ site: operation, futures: operation.awaited });
        }
      }
      if (exit.kind === 'branch' && exit.test.kind === 'select') {
        this.#add({ site: exit.test, futures: exit.test.futures });
      }
    }
  }

  #add(wait: FlowWait): void {
    this.#waits.set(wait.site, wait);
    for (const [position, future] of wait.futures.entries()) {
      if (this.#cases.has(future)) {
        unreachable(`The future ${future} is waited on by two waits.`);
      }
      this.#cases.set(future, { wait, position });
    }
  }

  /** The case `future` is of: its wait, opened by `open` where no case has opened it yet. */
  caseOf(
    future: ValueId,
    open: () => OpenWait,
  ): { readonly open: OpenWait; readonly position: number } {
    const { wait, position } =
      this.#cases.get(future) ?? unreachable(`The future ${future} is waited on by no wait.`);
    return { open: memo(this.#opened, wait, open), position };
  }

  /** The wait at `site`, opened by its cases, and its cases' futures, in order. */
  waitOf(
    site: WaitSite,
    span: AnchoredSpan,
  ): { readonly open: OpenWait; readonly futures: readonly ValueId[] } {
    const wait = this.#waits.get(site) ?? unreachable(`No wait at ${span.from}.`);
    const open = this.#opened.get(wait) ?? unreachable(`No case opened the wait at ${span.from}.`);
    return { open, futures: wait.futures };
  }

  /** Makes `register`, which owns it, what `future` gave once it settled. */
  give(future: ValueId, register: Register): void {
    this.#given.set(future, register);
  }

  /** What `future` gave once it settled. */
  givenBy(future: ValueId, span: AnchoredSpan): Register {
    return (
      this.#given.get(future) ??
      unreachable(`What the future at ${span.from} gave is read before it settled.`)
    );
  }

  /** Whether `register` holds what some future gave. */
  holdsGiven(register: Register): boolean {
    return [...this.#given.values()].includes(register);
  }
}

/**
 * The resolver of the case waiting on `future`, which an `onAwait`, `closed`, takes: of its
 * wait, opened now where it is the first case written.
 */
export function caseResolverOf(
  writer: FlowWriter,
  { future, closed }: { readonly future: ValueId; readonly closed: ClosedCall },
  span: AnchoredSpan,
): Register {
  const { context } = writer;
  const [type, mode] = resolverArguments(writer, closed);
  const { open, position } = writer.waits.caseOf(future, () => openWait(context, mode, span));
  return caseResolver(context, open, { type, position }, span);
}

/**
 * What a case waits on, of the `Resolver<T, K>` its `onAwait`, `closed`, takes: what its awaitable
 * gives once it settles, `T`, and the kind its wait waits in, `K` (proposal 8, Rule 5), which code
 * that never parks, a `select` with an `else`, has of its awaitable.
 */
function resolverArguments(writer: FlowWriter, closed: ClosedCall): readonly [Type, Persistence] {
  const { checker } = writer.context;
  const done = calledParameters(checker, closed)[1]?.type;
  const resolver =
    done === undefined
      ? undefined
      : substitute(done, substitutionOfCall(checker, closed), checker.typeRules);
  const [given, mode] =
    (resolver === undefined
      ? undefined
      : wellKnownArguments(checker, wellKnown.resolver, resolver)) ?? [];
  if (given === undefined || mode?.kind !== 'literal') {
    return unreachable(`An onAwait takes no resolver at ${closed.kind}.`);
  }
  return [given, mode.value === 'ista' ? 'ista' : 'live'];
}

/** An `await` (`suspend` at one): parks until its case decides its wait, then takes its value. */
export function awaited(
  writer: FlowWriter,
  suspend: Extract<Operation, { readonly op: 'suspend' }>,
) {
  const { site } = suspend;
  if (site.kind !== 'Await') {
    return;
  }
  const { context } = writer;
  const { code } = context;
  const { span } = site;
  const { open, futures } = writer.waits.waitOf(suspend, span);
  code.letGo([parked(context, open, { waypoint: waypointAt(context, site), span })], span);
  futures.forEach((future, position) => {
    writer.waits.give(future, caseValue(context, open, position, span));
  });
  code.letGo(waitRegisters(open), span);
}

/** A `select` (the banner): goes on to the block of the case decided, `to`'s last its `else`'s. */
export function selected(
  writer: FlowWriter,
  test: Extract<BranchTest, { readonly kind: 'select' }>,
  to: readonly BlockId[],
): void {
  const { node, holds } = test;
  const { context } = writer;
  const { code } = context;
  const { span } = node;
  const cases = selectCasesOf(node);
  if (cases.length === 0) {
    writer.goTo(to[0] ?? unreachable('A select goes nowhere.'), span);
    return;
  }
  const { open, futures } = writer.waits.waitOf(test, span);
  const position =
    node.elseClause === undefined
      ? parked(context, open, { waypoint: waypointAt(context, node), span })
      : decidedAt(context, open, span);
  const landings = cases.map(() => code.newLabel());
  const otherwise = node.elseClause === undefined ? undefined : code.newLabel();
  landings.forEach((landing, index) => {
    if (index === landings.length - 1 && otherwise === undefined) {
      code.jump(landing, span);
      return;
    }
    const next = code.newLabel();
    const at = context.constant(BigInt(index), intType, span);
    code.branch(code.equal(position, at, span), landing, next, span);
    code.place(next);
  });
  if (otherwise !== undefined) {
    code.jump(otherwise, span);
  }
  landings.forEach((landing, index) => {
    code.place(landing);
    const future = futures[index];
    if (future !== undefined) {
      writer.waits.give(future, caseValue(context, open, index, span));
    }
    const losers = holds.flatMap((held, other) => (other === index ? [] : held));
    code.letGo([position, ...waitRegisters(open), ...writer.registersEnding(losers)], span);
    writer.jumpTo(to[index] ?? unreachable('A select case goes nowhere.'), span);
  });
  if (otherwise !== undefined) {
    code.place(otherwise);
    code.letGo([position, ...waitRegisters(open), ...writer.registersEnding(holds.flat())], span);
    writer.jumpTo(to[cases.length] ?? unreachable('A select has no else.'), span);
  }
}
