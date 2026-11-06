/**
 * The trace a default asks for (`Error`'s `trace`, §3.12) leaves out the default's own frame by its
 * entry's mark, never by a count, so a default inlined into its caller still leaves out nothing.
 */

import { describe, expect, it } from 'vitest';
import { subsetDefinition } from '../../../test/definitions/subset.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';
import { callerTraceOf, traceOf } from './trace.ts';

/** The subset's code entries, by name. */
function codeNamed(name: string): CodeFunction {
  const entry = subsetDefinition.functions.find((candidate) => candidate.name === name);
  if (entry?.kind !== 'code') {
    throw new Error(`The subset has no code entry ${name}.`);
  }
  return entry;
}

/** A frame of `code` at its first instruction, marked as giving a default or not. */
function frameOf(name: string, givesDefault: boolean): { code: CodeFunction; pc: number } {
  return { code: { ...codeNamed(name), givesDefault }, pc: 0 };
}

describe("a default's caller trace", () => {
  it("leaves out the innermost frame when it is a default's, and only that one", () => {
    const frames = [
      frameOf('main.fib', true),
      frameOf('main.fib', true),
      frameOf('main.main', false),
    ];
    expect(callerTraceOf(subsetDefinition, frames)).toBe(
      traceOf(subsetDefinition, frames.slice(1)),
    );
  });

  it("keeps every frame when the innermost isn't a default's, as when a default is inlined", () => {
    const frames = [frameOf('main.fib', false), frameOf('main.main', false)];
    expect(callerTraceOf(subsetDefinition, frames)).toBe(traceOf(subsetDefinition, frames));
  });
});
