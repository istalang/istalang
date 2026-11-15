/**
 * The trace a default asks for (`Error`'s `trace`, §3.12) leaves out the innermost frame while it
 * computes a default in its prologue, by where the frame stands against its body's start, never by
 * a count; a frame past its prologue, or of code with none, is kept.
 */

import { describe, expect, it } from 'vitest';
import { subsetDefinition } from '../../../test/definitions/subset.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';
import { callerTraceText, traceText } from '../../definition/traces.ts';
import { tracedFrame } from './trace.ts';

/** The subset's code entries, by name. */
function codeNamed(name: string): CodeFunction {
  const entry = subsetDefinition.functions.find((candidate) => candidate.name === name);
  if (entry?.kind !== 'code') {
    throw new Error(`The subset has no code entry ${name}.`);
  }
  return entry;
}

/** `main.fib` given a prologue computing its parameter: `given`, then the body's mark. */
const fibWithPrologue: CodeFunction = (() => {
  const code = codeNamed('main.fib');
  const { span } = code;
  return {
    ...code,
    parameters: [{ reference: false, hasDefault: true }],
    instructions: [
      { kind: 'given', span, parameter: 0, target: 1 },
      { kind: 'body', span },
      ...code.instructions,
    ],
  };
})();

const inPrologue = { code: fibWithPrologue, pc: 0 };
const inBody = { code: fibWithPrologue, pc: 2 };
const withoutPrologue = { code: codeNamed('main.main'), pc: 0 };

describe("a default's caller trace", () => {
  it('leaves out the innermost frame while it is in its prologue, and only that one', () => {
    const frames = [inPrologue, inPrologue, withoutPrologue];
    expect(callerTraceText(subsetDefinition, frames.map(tracedFrame))).toBe(
      traceText(subsetDefinition, frames.slice(1).map(tracedFrame)),
    );
  });

  it('keeps every frame when the innermost is past its prologue, or has none', () => {
    for (const frames of [
      [inBody, inPrologue, withoutPrologue],
      [withoutPrologue, inPrologue],
    ]) {
      const traced = frames.map(tracedFrame);
      expect(callerTraceText(subsetDefinition, traced)).toBe(traceText(subsetDefinition, traced));
    }
  });
});
