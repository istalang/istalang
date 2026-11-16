/**
 * What running a program shows, the observation every pipeline is held to (docs/work/ir-first/
 * contracts.md, "Goldens"): how it ended, its log records and the calls its host saw, in order.
 *
 * - Disposal is observed through what it does: a `dispose` that logs or calls its host shows in
 *   those lines, in their order, so nothing reads a heap or a snapshot's shape.
 * - A panic shows its message and the innermost frame of the program's own modules, as a trace
 *   names it, its file relative to the program's directory.
 * - Log records drop their instance and time: which instance wrote one, and when on the fixed
 *   clock, is the pipeline's bookkeeping, not what the program said.
 */

import type { LogRecord } from '../../src/runtime/instance-state.ts';

/** How a run ended: its outcome as JSON text, its panic, or the state it stopped in unsettled. */
export type Ending =
  | { readonly outcome: string }
  | { readonly panic: string; readonly frame: string }
  | { readonly unsettled: string };

export interface Observation {
  readonly ending: Ending;
  readonly logs: readonly string[];
  readonly hostCalls: readonly string[];
}

/** `record` as an observation's line: its level, message and fields. */
export function logLine({ level, message, fields }: LogRecord): string {
  return `${level} ${message} ${jsonText(fields)}`;
}

/** A host call's line: the extern's key, then its arguments. */
export function hostCallLine(key: string, argumentValues: readonly unknown[]): string {
  return `${key} ${jsonText(argumentValues)}`;
}

/** A trace's frame in a std module, whose sources the rewrite replaces. */
const stdFrame = /\(std:[^)]*\)$/u;

/**
 * The innermost frame of `trace`, innermost first, in the program's own modules: a std frame's place
 * moves whenever the std's code does.
 */
export function innermostOwnFrame(trace: string): string {
  return trace.split('\n').find((frame) => !stdFrame.test(frame)) ?? '';
}

/** The ending of a panic with `message` and `trace`. */
export function panicEnding(message: string, trace: string): Ending {
  return { panic: message, frame: innermostOwnFrame(trace) };
}

/** `json`, JSON a host works with, as text, its bigints marked. */
function jsonText(json: unknown): string {
  return JSON.stringify(json, (_key, value: unknown) =>
    typeof value === 'bigint' ? `${value}n` : value,
  );
}

/** `entry`, a golden's or a step's, without its empty lists, so it holds only what was shown. */
export function withoutEmpty(entry: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => !(Array.isArray(value) && value.length === 0)),
  );
}
