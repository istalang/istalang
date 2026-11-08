/**
 * One system per outermost expression (design.md §4): a generic call or literal passed straight to
 * a call doesn't settle alone, but joins the system of the call it is passed to, which the
 * outermost one settles for all of them, as Kotlin's inference does.
 *
 * - A construct is chosen and its arguments matched first, its inference left open
 *   (`OpenInference`): its type is then in its variables. Passed where it may join (`JoinPlace`),
 *   it hands itself over; the call it is passed to matches it as any argument, in a system that starts
 *   as a copy of those of what joined it (types/inference/system.ts), so each candidate matches in
 *   its own.
 * - Everything a construct records waits for the outermost system to settle: its instantiation, its
 *   witnesses, its arguments' fits and wraps, its default calls and literal fields, and its type.
 *   Settling then judges every postponed argument, what joined first, solves every variable
 *   together, and completes each construct in the outermost system, what joined first, so one pass
 *   writes every record (`settleOutermost`).
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { Inference } from '../../types/inference/infer.ts';
import type { Settling } from '../../types/inference/settle.ts';
import type { Type } from '../../types/type/index.ts';

/** A call or literal chosen, its inference open until the outermost system settles. */
export interface OpenInference {
  /** Its inference, in the system its own call made, before anything it joins copies it. */
  readonly inference: Inference;
  /** Its value's type, in its variables. */
  readonly type: Type;
  /** How its type parameters settle where it stands. */
  readonly settling: Settling;
  /** Where its arguments might have joined it, each with what did, open as it is. */
  readonly joined: readonly JoinPlace[];
  /** Judges its postponed arguments in `joint`'s system (resolution/calls/function-arguments.ts). */
  readonly judge: (joint: Inference) => void;
  /** Completes it once `joint`'s system is settled, recording it; its type then. */
  readonly complete: (joint: Inference) => Type;
}

/**
 * Checks an item of a call or literal where it may join it (`place`), if it is one that may: a
 * call, a literal naming its type, or a collection literal (constructs/expressions/calls.ts);
 * undefined for anything else, which is checked as ever. A call joining is told what is `expected`
 * of it so far, which only advises, as a bare variant's enum.
 */
export type CheckJoining = (
  item: Expression,
  place: JoinPlace,
  expected?: Type,
) => Type | undefined;

/** An argument where it may join the call it is passed to, and the construct that joined there. */
export class JoinPlace {
  /** The argument, whose type is recorded once its system settles. */
  readonly node: Expression;
  #joined: OpenInference | undefined;

  constructor(node: Expression) {
    this.node = node;
  }

  /** The construct joined here, if one did. */
  get joined(): OpenInference | undefined {
    return this.#joined;
  }

  /**
   * Hands `open` over; whether it joined: a construct whose type mentions none of its variables
   * gains nothing from joining, so it settles alone.
   */
  join(open: OpenInference): boolean {
    const joins = open.inference.mentionsVariables(open.type);
    if (joins) {
      this.#joined = open;
    }
    return joins;
  }
}

/**
 * The type `open` has: joined at `place` where given and it joins there, its open type; else
 * settled as the outermost system, which completes it and what joined it.
 */
export function settledOrJoined(
  context: BodyContext,
  open: OpenInference,
  place: JoinPlace | undefined,
): Type {
  return place?.join(open) === true ? open.type : settleOutermost(context, open);
}

/**
 * Settles `open` as the outermost system: judges every postponed argument, solves its variables
 * together when anything joined it, then completes each construct, recording what joined with its
 * type settled; `open`'s type, settled.
 */
function settleOutermost(context: BodyContext, open: OpenInference): Type {
  const joint = open.inference;
  judgeAll(open, joint);
  const joined = everyJoined(open);
  if (joined.length > 0) {
    joint.solveJointly([...joined.map(({ construct }) => construct), open]);
  }
  for (const { node, construct } of joined) {
    const type = construct.complete(joint);
    context.checkWith(node, () => type);
  }
  return open.complete(joint);
}

/**
 * Judges `open`'s postponed arguments, what joined it first, and then what joined it while it was
 * judged, as a lambda's value does (resolution/calls/function-arguments.ts).
 */
function judgeAll(open: OpenInference, joint: Inference): void {
  const before = open.joined.length;
  for (const { joined } of open.joined) {
    if (joined !== undefined) {
      judgeAll(joined, joint);
    }
  }
  open.judge(joint);
  for (const { joined } of open.joined.slice(before)) {
    if (joined !== undefined) {
      judgeAll(joined, joint);
    }
  }
}

/** Every construct joined into `open`, at any depth, with its node, each after what joined it. */
function everyJoined(
  open: OpenInference,
): readonly { readonly node: Expression; readonly construct: OpenInference }[] {
  return open.joined.flatMap(({ node, joined }) =>
    joined === undefined ? [] : [...everyJoined(joined), { node, construct: joined }],
  );
}
