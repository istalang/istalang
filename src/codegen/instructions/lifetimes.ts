/**
 * Emitting releases (definition/instructions/lifetimes.ts): a release empties its registers, letting
 * go of what a counted one held, so a cell register's next write makes a new cell, as each pass of a
 * loop's body needs; `keep` adds what its registers hold to its list, references aside, which hold
 * nothing.
 */

import type { lifetimeInstructions } from '../../definition/instructions/lifetimes.ts';
import type { Emitters } from './emitters.ts';

export const lifetimeEmitters: Emitters<typeof lifetimeInstructions> = {
  release: (scope, i) => i.registers.map((register) => scope.emptied(register)).join(' '),
  keep: (scope, i) => {
    const held = i.registers.filter((register) => scope.holding(register) !== 'reference');
    return scope.write(
      i.into,
      `keep(r${i.into}, [${held.map((register) => `r${register}`).join(', ')}])`,
    );
  },
};
