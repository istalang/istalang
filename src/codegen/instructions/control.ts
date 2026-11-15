/**
 * Emitting control flow inside one function (definition/instructions/control.ts) and its prologue
 * (definition/instructions/prologue.ts): jumps become a `for (;;) switch (pc)`'s cases, and an async
 * function's `return` settles its own future.
 */

import type { controlInstructions } from '../../definition/instructions/control.ts';
import type { prologueInstructions } from '../../definition/instructions/prologue.ts';
import { jump } from '../entry-scope.ts';
import type { Emitters } from './emitters.ts';

export const controlEmitters: Emitters<typeof controlInstructions> = {
  jump: (_scope, i) => jump(i.target),
  branch: (scope, i) =>
    `pc = ${scope.read(i.condition)} === true ? ${i.whenTrue} : ${i.whenFalse}; continue;`,
  switch: (scope, i) => {
    const cases = i.targets.map((target, variant) => `case ${variant}: ${jump(target)}`);
    const otherwise = i.otherwise === undefined ? 'throw noVariant(t);' : jump(i.otherwise);
    return `switch ((t = ${scope.read(i.value)}).variant) { ${cases.join(' ')} default: ${otherwise} }`;
  },
  return: (scope, i) => scope.returned(i.value),
};

export const prologueEmitters: Emitters<typeof prologueInstructions> = {
  given: (_scope, i) => `if (r${i.parameter} !== undefined) { ${jump(i.target)} }`,
  // Only a mock acts on reaching the body, and mocks stay on the interpreter.
  body: () => '',
};
