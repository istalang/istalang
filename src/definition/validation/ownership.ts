/**
 * The ownership verifier (ir-first design, decision 5): every register owning a value lets go of
 * it, or moves it on, exactly once on every path, so no backend leaks a holder or lets go twice.
 *
 * A forward analysis over the code's paths gives each owning register a state: empty, owning, or
 * owning on some paths only. Borrowed registers own nothing and are left out, as are the registers
 * of transients, whose cells the runtime keeps for the call making them (../instructions/places.ts).
 *
 * - Writing into a register that may own something leaks it: lowering lets go of it first.
 * - Moving out of a register needs it owning on every path; moving out of a borrowed one, or
 *   letting go of one, is a contradiction. Letting go of an empty register does nothing.
 * - Reading a register that is empty on every path reads nothing.
 * - `return` and `stopped` end the call: nothing may still own anything there but what `return`
 *   moves out.
 */

import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { type Instruction, operandsOf } from '../instructions/instruction.ts';
import type { Register } from '../operands.ts';
import type { CodeFunction } from '../tables/functions.ts';
import { transientRegistersOf } from '../tables/functions.ts';

/** A register's state where control reaches: empty, owning, or owning on some paths. */
type State = 'empty' | 'owning' | 'maybe';

/** What an instruction does to ownership: what it moves out of, and what it writes owning. */
interface Effect {
  readonly moved: readonly Register[];
  readonly owned: readonly Register[];
  readonly borrowed: readonly Register[];
  readonly letGo: readonly Register[];
}

const none: readonly Register[] = [];

const effects: Handlers<undefined, Instruction, [], Partial<Effect>> = {
  constant: (_, i) => ({ owned: [i.dst] }),
  move: (_, i) => ({ moved: [i.src], owned: [i.dst] }),
  copy: (_, i) => ({ owned: [i.dst] }),
  tuple: (_, i) => ({ moved: i.elements, owned: [i.dst] }),
  struct: (_, i) => ({ moved: i.fields, owned: [i.dst] }),
  variant: (_, i) => ({ moved: i.fields, owned: [i.dst] }),
  array: (_, i) => ({
    moved: i.elements.filter((element) => !element.spread).map((element) => element.value),
    owned: [i.dst],
  }),
  map: (_, i) => ({
    moved: i.entries.flatMap((entry) => (entry.kind === 'entry' ? [entry.key, entry.value] : [])),
    owned: [i.dst],
  }),
  closure: (_, i) => ({ moved: i.captures, owned: [i.dst] }),
  currentClosure: (_, i) => ({ borrowed: [i.dst] }),
  tupleItem: (_, i) => ({ borrowed: [i.dst] }),
  structField: (_, i) => ({ borrowed: [i.dst] }),
  variantField: (_, i) => ({ borrowed: [i.dst] }),
  equal: (_, i) => ({ owned: [i.dst] }),
  not: (_, i) => ({ owned: [i.dst] }),
  order: (_, i) => ({ owned: [i.dst] }),
  primitive: (_, i) => ({ owned: [i.dst] }),
  newCell: (_, i) => ({ moved: [i.value], owned: [i.dst] }),
  load: (_, i) => ({ owned: [i.dst] }),
  store: (_, i) => ({ moved: [i.value] }),
  reference: (_, i) => ({ borrowed: [i.dst] }),
  transient: (_, i) => ({ borrowed: [i.dst] }),
  contextConstant: (_, i) => ({ owned: [i.dst] }),
  makeContextConstant: () => ({}),
  jump: () => ({}),
  branch: () => ({}),
  switch: () => ({}),
  return: (_, i) => ({ moved: [i.value] }),
  unreachable: () => ({}),
  call: (_, i) => ({ owned: i.dst === undefined ? none : [i.dst] }),
  currentCall: (_, i) => ({ borrowed: [i.dst] }),
  given: () => ({}),
  mocked: (_, i) => ({ owned: [i.dst] }),
  park: (_, i) => ({ owned: [i.dst] }),
  stopped: () => ({}),
  letGo: (_, i) => ({ letGo: i.registers }),
};

function effectOf(subject: Instruction): Effect {
  const found = handlerOf(effects, subject)(undefined, subject);
  return {
    moved: found.moved ?? none,
    owned: found.owned ?? none,
    borrowed: found.borrowed ?? none,
    letGo: found.letGo ?? none,
  };
}

/** Where control goes from the instruction at `pc` of `code`. */
function successorsOf(code: CodeFunction, pc: number): readonly number[] {
  const subject = code.instructions[pc];
  if (subject === undefined) {
    return none;
  }
  const { labels } = operandsOf(subject);
  switch (subject.kind) {
    case 'jump':
    case 'branch':
    case 'switch':
      return labels;
    case 'return':
    case 'stopped':
    case 'unreachable':
      return none;
    default:
      return [pc + 1, ...labels];
  }
}

function joined(first: State, second: State): State {
  return first === second ? first : 'maybe';
}

/** Every way `code` breaks the ownership rules, each naming the instruction. */
export function ownershipIssues(code: CodeFunction): readonly string[] {
  const exempt = new Set<Register>(transientRegistersOf(code));
  code.registers.forEach((entry, register) => {
    if (entry.borrowed) {
      exempt.add(register);
    }
  });
  const tracked = (register: Register) => !exempt.has(register);
  const states: (State[] | undefined)[] = code.instructions.map(() => undefined);
  states[0] = code.registers.map(() => 'empty');
  const issues = new Set<string>();
  const pending = [0];
  while (pending.length > 0) {
    const pc = pending.pop() ?? 0;
    const before = states[pc];
    const subject = code.instructions[pc];
    if (before === undefined || subject === undefined) {
      continue;
    }
    const after = [...before];
    const issue = (message: string) => issues.add(`at ${String(pc)} (${subject.kind}): ${message}`);
    const effect = effectOf(subject);
    for (const register of operandsOf(subject).read) {
      if (tracked(register) && after[register] === 'empty' && !effect.letGo.includes(register)) {
        issue(`reads register ${String(register)}, empty on every path.`);
      }
    }
    for (const register of effect.moved) {
      if (!tracked(register)) {
        issue(`moves out of register ${String(register)}, which owns nothing.`);
      } else if (after[register] !== 'owning') {
        issue(`moves out of register ${String(register)}, empty on some path.`);
      }
      after[register] = 'empty';
    }
    for (const register of effect.letGo) {
      if (!tracked(register)) {
        issue(`lets go of register ${String(register)}, which owns nothing.`);
      }
      after[register] = 'empty';
    }
    for (const register of effect.owned) {
      if (exempt.has(register) && !transientRegistersOf(code).includes(register)) {
        issue(`writes an owned value into borrowed register ${String(register)}.`);
      } else if (tracked(register)) {
        if (after[register] !== 'empty') {
          issue(`overwrites what register ${String(register)} owns.`);
        }
        after[register] = 'owning';
      }
    }
    for (const register of effect.borrowed) {
      if (tracked(register)) {
        issue(`borrows into owning register ${String(register)}.`);
      }
    }
    if (subject.kind === 'return' || subject.kind === 'stopped') {
      after.forEach((state, register) => {
        if (state !== 'empty' && tracked(register)) {
          issue(`ends the call while register ${String(register)} still owns its value.`);
        }
      });
    }
    for (const next of successorsOf(code, pc)) {
      const known = states[next];
      const merged = known === undefined ? after : known.map((state, r) => joined(state, after[r] ?? 'empty'));
      if (known === undefined || merged.some((state, r) => state !== known[r])) {
        states[next] = merged;
        pending.push(next);
      }
    }
  }
  return [...issues];
}
