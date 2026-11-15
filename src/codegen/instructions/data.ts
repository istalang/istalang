/**
 * Emitting the instructions that build, read and write values (definition/instructions/data.ts).
 *
 * Values keep the Definition's shapes, so what an instruction builds is the object the interpreter
 * builds. They are immutable to the program: a store copies along its path (`withPart`).
 */

import type { dataInstructions } from '../../definition/instructions/data.ts';
import { type EntryScope, jump } from '../entry-scope.ts';
import type { Emitters } from './emitters.ts';

const relations = {
  less: '<',
  lessOrEqual: '<=',
  greater: '>',
  greaterOrEqual: '>=',
} as const;

export const dataEmitters: Emitters<typeof dataInstructions> = {
  constant: (scope, i) => scope.write(i.dst, `C[${i.constant}]`),
  contextConstant: (scope, i) =>
    `if ((t = run.contextConstant(${JSON.stringify(i.name)})) !== undefined) { ${scope.write(i.dst, 't')} ${jump(i.target)} }`,
  makeContextConstant: (scope, i) =>
    `run.makeContextConstant(${JSON.stringify(i.name)}, ${scope.read(i.value)});`,
  transient: (scope, i) =>
    `if ((t = run.transient(${scope.index}, ${i.dst})) !== undefined) { r${i.dst} = t; ${jump(i.target)} }`,
  move: (scope, i) => scope.write(i.dst, scope.read(i.src)),
  tuple: (scope, i) =>
    scope.write(i.dst, `{kind: 'tuple', elements: [${reads(scope, i.elements)}]}`),
  struct: (scope, i) =>
    scope.write(i.dst, `{kind: 'struct', type: ${i.type}, fields: [${reads(scope, i.fields)}]}`),
  variant: (scope, i) =>
    scope.write(
      i.dst,
      `{kind: 'variant', type: ${i.type}, variant: ${i.variant}, fields: [${reads(scope, i.fields)}]}`,
    ),
  field: (scope, i) => scope.write(i.dst, `field(${scope.read(i.src)}, ${i.index})`),
  store: (scope, i) => scope.store(i.place, scope.read(i.value)),
  newCell: (scope, i) => scope.write(i.dst, `cellOf(${scope.read(i.value)})`),
  readCell: (scope, i) => scope.write(i.dst, `${scope.read(i.cell)}.v`),
  writeCell: (scope, i) => `${scope.read(i.cell)}.v = ${scope.read(i.value)};`,
  array: (scope, i) => {
    const elements = i.elements.map((element) =>
      element.kind === 'item'
        ? scope.read(element.value)
        : `...${scope.read(element.value)}.elements`,
    );
    return scope.write(i.dst, `{kind: 'array', elements: [${elements.join(', ')}]}`);
  },
  map: (scope, i) => {
    const entries = i.entries.map((entry) =>
      entry.kind === 'entry'
        ? `[${scope.read(entry.key)}, ${scope.read(entry.value)}]`
        : `...mapValueOf(${scope.read(entry.value)}).entries`,
    );
    return scope.write(i.dst, `mapOf([${entries.join(', ')}])`);
  },
  closure: (scope, i) => {
    const captures = i.captures.map((register) => scope.captured(register));
    return scope.write(
      i.dst,
      `{kind: 'closure', function: ${i.function}, captures: [${captures.join(', ')}]}`,
    );
  },
  currentClosure: (scope, i) =>
    scope.write(i.dst, `cl ?? {kind: 'closure', function: ${scope.index}, captures: []}`),
  equal: (scope, i) => scope.write(i.dst, `eq(${scope.read(i.left)}, ${scope.read(i.right)})`),
  not: (scope, i) => scope.write(i.dst, `${scope.read(i.src)} !== true`),
  order: (scope, i) =>
    scope.write(i.dst, `${scope.read(i.comparison)} ${relations[i.relation]} 0n`),
};

function reads(scope: EntryScope, registers: readonly number[]): string {
  return registers.map((register) => scope.read(register)).join(', ');
}
