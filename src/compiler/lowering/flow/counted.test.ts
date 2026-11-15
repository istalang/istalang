/**
 * Which registers an entry counts (docs/work/js-codegen/design.md, "What lowering adds"): every
 * register but those whose values' types reach no disposable, read as the instance reads them, so a
 * future is counted and an `Int` isn't, and one generic function counts per instantiation.
 */

import { describe, expect, it } from 'vitest';
import type { Definition } from '../../../definition/definition.ts';
import type { Instruction } from '../../../definition/instructions/instruction.ts';
import type { CodeFunction } from '../../../definition/tables/functions.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { compiledDefinition } from '../../compile.test-kit.ts';

function compiled(lines: readonly string[]): Definition {
  return compiledDefinition(stdProgramOf({ main: lines.join('\n') }), 'main');
}

function entryNamed(definition: Definition, name: string): CodeFunction {
  const entry = definition.functions.find((each) => each.name === name);
  if (entry?.kind !== 'code') {
    throw new Error(`No code entry '${name}' in ${definition.functions.map((each) => each.name)}.`);
  }
  return entry;
}

/** The register the first `kind` instruction of `entry` writes. */
function writtenBy(entry: CodeFunction, kind: Instruction['kind']): number {
  const instruction = entry.instructions.find((each) => each.kind === kind);
  if (instruction === undefined || !('dst' in instruction) || instruction.dst === undefined) {
    throw new Error(`No ${kind} writing a register in ${entry.name}.`);
  }
  return instruction.dst;
}

const program = [
  "import * as time from 'time'",
  'live async fn later() -> Int:',
  '  await time.delay(1ms)',
  '  1',
  'fn same<T>(value: T) -> T: value',
  'live async fn main() -> Int:',
  '  const pending = same(later())',
  '  same(2) + await pending',
];

describe('counted registers', () => {
  it('counts the register a future is called into, and not one only a number is written to', () => {
    const main = entryNamed(compiled(program), 'main.main');
    expect(main.counted).toContain(writtenBy(main, 'call'));
    expect(main.counted).not.toContain(writtenBy(main, 'constant'));
  });

  it('counts per instantiation: the registers of a future, but none of an Int', () => {
    const definition = compiled(program);
    const ofInt = entryNamed(definition, 'main.same<Int>');
    const ofFuture = definition.functions.find(
      (each) => each.kind === 'code' && each.name.startsWith('main.same<') && each !== ofInt,
    );
    expect(ofInt.counted).toEqual([]);
    expect(ofFuture?.kind === 'code' && ofFuture.counted).toContain(0);
  });
});
