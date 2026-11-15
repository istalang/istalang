/**
 * A trace of compiled code, read off the JavaScript stack (docs/work/js-codegen/design.md, "Traces"),
 * so nothing is paid for it until a panic or a native asks.
 *
 * - Each instruction is one line of the program's module, from its entry's `line` on, so a stack
 *   frame in the module names an entry and an instruction; frames elsewhere (the runtime library,
 *   a host) are passed over. Where the module's frames show and at which lines is read off its
 *   `site`, an `Error` made on a known line, since a loader may rename the module or move its lines
 *   (a test runner's does).
 * - After an `await`, the stack holds only the frames since the execution resumed, and so does the
 *   trace (tracker F35). It holds as many frames as the engine keeps.
 */

import { callerTraceText, type TracedFrame, traceText } from '../definition/traces.ts';
import { type CodeShape, type ProgramTables, siteLine } from './program-tables.ts';

/** What a trace reads of a program. */
type Traced = Pick<ProgramTables<unknown, unknown>, 'site' | 'modules' | 'functions'>;

/** A stack frame's location: where it is, then its line and column. */
const frameLocation = /(?<where>[^\s(@]+):(?<line>\d+):\d+\)?\s*$/u;

export class Traces {
  readonly #program: Traced;
  /** Where the module's frames show on a stack. */
  readonly #where: string | undefined;
  /** How many lines a stack shows the module's lines moved by. */
  readonly #shift: number;
  /** The code entries, by the line of their first instruction. */
  readonly #entries: readonly CodeShape[];

  constructor(program: Traced) {
    this.#program = program;
    const [site] = locations(program.site.stack);
    this.#where = site?.where;
    this.#shift = site === undefined ? 0 : site.line - siteLine;
    this.#entries = program.functions
      .filter((entry): entry is CodeShape => entry.kind === 'code')
      .toSorted((first, second) => first.line - second.line);
  }

  /** The trace of where `stack`, an `Error`'s, stands, innermost first. */
  of(stack: string | undefined): string {
    return traceText(this.#program, this.#frames(stack));
  }

  /** The trace of the code a default gives its value to: `of` without a frame in its prologue. */
  callerOf(stack: string | undefined): string {
    return callerTraceText(this.#program, this.#frames(stack));
  }

  #frames(stack: string | undefined): TracedFrame[] {
    return locations(stack).flatMap(({ where, line }) => {
      const frame = where === this.#where ? this.#frameAt(line - this.#shift) : undefined;
      return frame === undefined ? [] : [frame];
    });
  }

  /** The frame standing at module line `line`, if it holds an instruction. */
  #frameAt(line: number): TracedFrame | undefined {
    const entry = this.#entries.findLast((candidate) => candidate.line <= line);
    const instruction = entry === undefined ? -1 : line - entry.line;
    if (entry === undefined || instruction >= entry.spans.length) {
      return undefined;
    }
    return {
      name: entry.name,
      module: entry.module,
      offset: entry.spans[instruction] ?? entry.start,
      inPrologue: instruction < entry.body,
    };
  }
}

/** The location of each frame of `stack`, innermost first. */
function locations(stack: string | undefined): { readonly where: string; readonly line: number }[] {
  return (stack ?? '').split('\n').flatMap((frame) => {
    const groups = frameLocation.exec(frame)?.groups;
    return groups?.where === undefined ? [] : [{ where: groups.where, line: Number(groups.line) }];
  });
}
