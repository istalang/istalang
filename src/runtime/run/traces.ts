/**
 * Traces of compiled code, read off the JavaScript stack (§3.12), so nothing is paid for them
 * until a panic or a native asks.
 *
 * - Each instruction is one line of the program's code (codegen/entry.ts), and the code says
 *   which entry and instruction each line runs, so a frame of the program names an instruction by
 *   its line; frames elsewhere (the run, natives, a host) are passed over. Where the program's
 *   frames show, and how far their lines moved, comes from `site`, an `Error` made on a known line.
 * - A frame stands in its prologue before its body begins: past the default its last `given`
 *   skips (functions/frame-variables.ts), so a default's trace starts at its caller.
 * - A frame on a frame record shows only from where it last resumed: the stack holds nothing of
 *   what awaited it.
 * - A frame standing at its `mocked` handed its call over to a mock (§10), whose frames stand for
 *   it: it runs none of its own code, so it shows none.
 * - A panic is a thrown `Panic`, or a host limit `panicOf` names (a stack overflow is the recursion
 *   panic); anything else thrown is a bug.
 */

import type { Definition } from '../../definition/definition.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';
import { callerTraceText, type TracedFrame, traceText } from '../../definition/traces.ts';
import { panicOf, wholeStack } from '../natives.ts';

/** A stack frame's location: where it is, then its line and column. */
const frameLocation = /(?<where>[^\s(@]+):(?<line>\d+):\d+\)?\s*$/u;

/** The line of the program's code `site` is made on (codegen/emit.ts). */
const siteLine = 2;

export class Traces {
  readonly #definition: Definition;
  readonly #lines: readonly (readonly [number, number] | undefined)[];
  readonly #where: string | undefined;
  readonly #shift: number;

  constructor(
    definition: Definition,
    lines: readonly (readonly [number, number] | undefined)[],
    site: Error,
  ) {
    this.#definition = definition;
    this.#lines = lines;
    const [located] = locations(site.stack);
    this.#where = located?.where;
    this.#shift = located === undefined ? 0 : located.line - siteLine;
  }

  /** The panic `error` is, its trace read off its stack; anything else is a bug, rethrown. */
  panicOf(error: unknown): { readonly message: string; readonly trace: string } {
    const panic = panicOf(error);
    if (panic === undefined) {
      throw error;
    }
    const cause = panic.cause instanceof Error ? panic.cause : panic;
    return { message: panic.message, trace: panic.trace ?? this.#of(cause.stack) };
  }

  /** Where every running frame is, innermost first, as an `Error`'s `trace` reads (§3.12). */
  here(): string {
    return this.#of(wholeStack('the stack, read for a trace'));
  }

  /** The trace of the code a default gives its value to: `here` without a frame in its prologue. */
  callerHere(): string {
    return callerTraceText(
      this.#definition,
      this.#frames(wholeStack('the stack, read for a trace')),
    );
  }

  #of(stack: string | undefined): string {
    return traceText(this.#definition, this.#frames(stack));
  }

  #frames(stack: string | undefined): TracedFrame[] {
    return locations(stack).flatMap(({ where, line }) => {
      const frame = where === this.#where ? this.#frameAt(line - this.#shift) : undefined;
      return frame === undefined ? [] : [frame];
    });
  }

  /** The frame standing at program line `line` (1-based), if it runs an instruction of its own. */
  #frameAt(line: number): TracedFrame | undefined {
    const [index, pc] = this.#lines[line - 1] ?? [];
    const entry = index === undefined ? undefined : this.#definition.functions[index];
    if (entry?.kind !== 'code' || pc === undefined) {
      return undefined;
    }
    const instruction = entry.instructions[pc];
    if (instruction?.kind === 'mocked') {
      return undefined;
    }
    return {
      name: entry.name,
      module: entry.module,
      offset: instruction?.span.start ?? entry.span.start,
      inPrologue: pc < bodyStart(entry),
    };
  }
}

/** Where `entry`'s body begins: past its last default's, or at its start without one. */
function bodyStart(entry: CodeFunction): number {
  const last = entry.instructions.findLast((each) => each.kind === 'given');
  return last?.kind === 'given' ? last.target + 1 : 0;
}

/** The location of each frame of `stack`, innermost first. */
function locations(stack: string | undefined): { readonly where: string; readonly line: number }[] {
  return (stack ?? '').split('\n').flatMap((frame) => {
    const groups = frameLocation.exec(frame)?.groups;
    return groups?.where === undefined ? [] : [{ where: groups.where, line: Number(groups.line) }];
  });
}
