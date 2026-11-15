/**
 * Emitting waits (definition/instructions/suspension.ts). `await` and a blocking `select` yield
 * the wait to the run driving the body (live/run.ts), which resumes it with the wait's decision:
 * always later, as the interpreter's waiter stops even at a wait decided already and runs after
 * every execution ready before it (spec §6).
 *
 * - Ending a wait takes it out of its register.
 * - A decided `select` empties the registers of the cases it lost (spec §8) and binds its winner's
 *   value; one with `otherwise` that finds its wait undecided withdraws it and goes there.
 */

import type { suspensionInstructions } from '../../definition/instructions/suspension.ts';
import { type EntryScope, jump } from '../entry-scope.ts';
import type { Emitters } from './emitters.ts';

type Select = Parameters<Emitters<typeof suspensionInstructions>['select']>[1];

export const suspensionEmitters: Emitters<typeof suspensionInstructions> = {
  wait: (scope, i) => scope.write(i.dst, 'run.wait()'),
  resolver: (scope, i) => scope.write(i.dst, `run.resolver(${scope.read(i.wait)}, ${i.position})`),
  await: (scope, i) =>
    `t = yield r${i.wait}; r${i.wait} = undefined; ${scope.write(i.dst, 't.value')}`,
  select: (scope, i) => {
    const decision =
      i.otherwise === undefined
        ? `t = yield r${i.wait};`
        : `t = run.selection(r${i.wait}); if (t === undefined) { r${i.wait} = undefined; ${jump(i.otherwise)} }`;
    return `${decision} r${i.wait} = undefined; switch (t.position) { ${cases(scope, i)} }`;
  },
};

/** Each case of `select`: its losers emptied, its value bound, and on to its body. */
function cases(scope: EntryScope, select: Select): string {
  return select.cases
    .map((winner, position) => {
      const losers = select.cases
        .filter((_, other) => other !== position)
        .flatMap((loser) => loser.holds)
        .map((register) => `r${register} = undefined;`);
      const bind = winner.bind === undefined ? '' : scope.write(winner.bind, 't.value');
      return `case ${position}: ${losers.join(' ')} ${bind} ${jump(winner.target)}`;
    })
    .join(' ');
}
