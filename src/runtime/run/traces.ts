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
 */

import type { Definition } from '../../definition/definition.ts';
import { traceText, callerTraceText, type TracedFrame } from '../../definition/traces.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';

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

  /** The trace of where `stack`, an `Error`'s, stands, innermost first. */
  of(stack: string | undefined): string {
    return traceText(this.#definition, this.#frames(stack));
  }

  /** The trace of the code a default gives its value to: `of` without a frame in its prologue. */
  callerOf(stack: string | undefined): string {
    return callerTraceText(this.#definition, this.#frames(stack));
  }

  #frames(stack: string | undefined): TracedFrame[] {
    return locations(stack).flatMap(({ where, line }) => {
      const frame = where === this.#where ? this.#frameAt(line - this.#shift) : undefined;
      return frame === undefined ? [] : [frame];
    });
  }

  /** The frame standing at program line `line` (1-based), if it runs an instruction. */
  #frameAt(line: number): TracedFrame | undefined {
    const [index, pc] = this.#lines[line - 1] ?? [];
    const entry = index === undefined ? undefined : this.#definition.functions[index];
    if (entry?.kind !== 'code' || pc === undefined) {
      return undefined;
    }
    const instruction = entry.instructions[pc];
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
