/**
 * A `switch` as codegen writes it: a variant past its targets goes to `otherwise`, and with no
 * `otherwise`, the targets cover every variant, so one past them breaks an invariant rather than
 * jumping anywhere.
 */

import { describe, expect, it } from 'vitest';
import type { InstructionOf } from '../definition/instructions/instruction.ts';
import { type EntryScope, emitInstruction } from './instructions.ts';

const span = { start: 0, end: 0 };

const scope: EntryScope = {
  index: 0,
  entry: {
    kind: 'code',
    name: 'main.f',
    module: 0,
    span,
    annotations: [],
    mode: 'simple',
    parameters: [],
    captures: 0,
    registers: [],
    instructions: [],
  },
  functions: [],
  types: [],
  constants: [],
  onFrames: false,
  jumps: true,
};

class Unreachable extends Error {}

/** Where the switch `instruction` goes on a value of `variant`. */
function target(instruction: InstructionOf<'switch'>, variant: number): unknown {
  const code = emitInstruction(scope, instruction);
  const run = new Function(
    'r0',
    'unreachableHere',
    `let pc; for (let once = true; once; once = false) { ${code} } return pc;`,
  );
  return run({ variant }, () => new Unreachable());
}

describe('a switch', () => {
  const targets = [3, 5];

  it('goes to the target of its variant', () => {
    expect(target({ kind: 'switch', span, value: 0, targets }, 1)).toBe(5);
  });

  it('goes to `otherwise` past its targets', () => {
    expect(target({ kind: 'switch', span, value: 0, targets, otherwise: 7 }, 2)).toBe(7);
  });

  it('breaks an invariant past its targets with no `otherwise`', () => {
    expect(() => target({ kind: 'switch', span, value: 0, targets }, 2)).toThrow(Unreachable);
  });
});
