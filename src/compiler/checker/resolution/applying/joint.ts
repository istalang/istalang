/**
 * One system per outermost expression (design.md §4): a generic call or literal passed straight to
 * a call doesn't settle alone, but joins the system of the call it is passed to, which the
 * outermost one settles for all of them, as Kotlin's inference does.
 *
 * - A construct is chosen and its arguments matched first, its inference left open
 *   (`OpenInference`): its type is then in its variables.
 * - Everything a construct records waits for the outermost system to settle: its instantiation, its
 *   witnesses, its arguments' fits and wraps, its default calls and literal fields. Settling then
 *   judges every postponed argument, what joined first, and completes each construct in the
 *   outermost system, what joined first, so one pass writes every record (`settleOutermost`).
 */

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
  /** What joined it, each open as it is. */
  readonly joined: readonly OpenInference[];
  /** Judges its postponed arguments in `joint`'s system (resolution/calls/function-arguments.ts). */
  readonly judge: (joint: Inference) => void;
  /** Completes it once `joint`'s system is settled, recording it; its type then. */
  readonly complete: (joint: Inference) => Type;
}

/**
 * Settles `open` as the outermost system: judges every postponed argument, then completes each
 * construct; `open`'s type, settled.
 */
export function settleOutermost(open: OpenInference): Type {
  const constructs = everyConstruct(open);
  for (const construct of constructs) {
    construct.judge(open.inference);
  }
  const types = constructs.map((construct) => construct.complete(open.inference));
  return types.at(-1) ?? open.type;
}

/** `open` and every construct joined into it, each after what joined it. */
function everyConstruct(open: OpenInference): readonly OpenInference[] {
  return [...open.joined.flatMap(everyConstruct), open];
}
