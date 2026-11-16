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
 * - A write that jumps when it finds a value (`contextConstant`, `mocked`) owns it only where it
 *   jumps to; going on, it found none, and the register stays as it was.
 */

import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { type Instruction, operandsOf, successorsOf } from '../instructions/instruction.ts';
import type { Register } from '../operands.ts';
import type { CodeFunction } from '../tables/functions.ts';
import { transientRegistersOf } from '../tables/functions.ts';

/** A register's state where control reaches: empty, owning, or owning on some paths. */
type State = 'empty' | 'owning' | 'maybe';

/**
 * What an instruction does to ownership: what it moves out of, and what it writes owning. A
 * conditional write (`taken`) owns only on the jump to its label, as a context constant found or a
 * mock that holds: going on past it, its register stays empty.
 */
interface Effect {
  readonly moved: readonly Register[];
  readonly owned: readonly Register[];
  readonly borrowed: readonly Register[];
  readonly letGo: readonly Register[];
  readonly taken: { readonly owned: readonly Register[]; readonly to: number } | undefined;
}

const none: readonly Register[] = [];

const effects: Handlers<CodeFunction, Instruction, [], Partial<Effect>> = {
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
  append: (_, i) => ({ moved: [i.collection, i.item], owned: [i.dst] }),
  appendEntry: (_, i) => ({ moved: [i.collection, i.key, i.value], owned: [i.dst] }),
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
  load: (code, i) =>
    code.registers[i.dst]?.borrowed === true ? { borrowed: [i.dst] } : { owned: [i.dst] },
  store: (_, i) => ({ moved: [i.value] }),
  reference: (_, i) => ({ borrowed: [i.dst] }),
  transient: (_, i) => ({ borrowed: [i.dst] }),
  contextConstant: (_, i) => ({ taken: { owned: [i.dst], to: i.target } }),
  makeContextConstant: () => ({}),
  jump: () => ({}),
  branch: () => ({}),
  switch: () => ({}),
  return: (_, i) => ({ moved: [i.value] }),
  unreachable: () => ({}),
  call: (_, i) => ({ owned: i.dst === undefined ? none : [i.dst] }),
  currentCall: (_, i) => ({ borrowed: [i.dst] }),
  given: () => ({}),
  mocked: (_, i) => ({ taken: { owned: [i.dst], to: i.landing } }),
  park: (_, i) => ({ owned: [i.dst] }),
  stopped: () => ({}),
  letGo: (_, i) => ({ letGo: i.registers }),
};

function effectOf(code: CodeFunction, subject: Instruction): Effect {
  const found = handlerOf(effects, subject)(code, subject);
  return {
    moved: found.moved ?? none,
    owned: found.owned ?? none,
    borrowed: found.borrowed ?? none,
    letGo: found.letGo ?? none,
    taken: found.taken,
  };
}

function joined(first: State, second: State): State {
  return first === second ? first : 'maybe';
}

/** Every way `code` breaks the ownership rules, each naming the instruction. */
export function ownershipIssues(code: CodeFunction): readonly string[] {
  return analyzed(code).issues;
}

/**
 * The registers each instruction of `code` finds owning their value on every path reaching it; none
 * for an instruction no path reaches. Borrowed registers and transients' own nothing.
 */
export function owningBefore(code: CodeFunction): readonly (ReadonlySet<Register> | undefined)[] {
  return analyzed(code).states.map((state) =>
    state === undefined
      ? undefined
      : new Set(state.flatMap((each, register) => (each === 'owning' ? [register] : []))),
  );
}

/** The forward analysis of `code`: each instruction's settled state, and every rule broken. */
function analyzed(code: CodeFunction): {
  readonly states: readonly (State[] | undefined)[];
  readonly issues: readonly string[];
} {
  const transients = new Set<Register>(transientRegistersOf(code));
  const borrowed = new Set<Register>(
    code.registers.flatMap((entry, register) => (entry.borrowed ? [register] : [])),
  );
  const registers: Registers = {
    transients,
    tracked: (register) => !(transients.has(register) || borrowed.has(register)),
  };
  const states: (State[] | undefined)[] = code.instructions.map(() => undefined);
  states[0] = code.registers.map(() => 'empty');
  // An instruction is judged on its last visit, at the state the analysis settles on for it.
  const issuesAt = new Map<number, readonly string[]>();
  const pending = [0];
  while (pending.length > 0) {
    const pc = pending.pop() ?? 0;
    const before = states[pc];
    const subject = code.instructions[pc];
    if (before !== undefined && subject !== undefined) {
      const { after, found, taken } = judged(code, subject, before, registers);
      issuesAt.set(
        pc,
        found.map((message) => `at ${String(pc)} (${subject.kind}): ${message}`),
      );
      pending.push(
        ...successorsOf(subject, pc).filter((next) =>
          reachedAnew(states, next, next === taken?.to ? taken.after : after),
        ),
      );
    }
  }
  const issues = [...issuesAt.entries()]
    .toSorted(([first], [second]) => first - second)
    .flatMap(([, found]) => found);
  return { states, issues };
}

/** Joins `after` into what `next` starts with; whether that changed it, so it is judged again. */
function reachedAnew(
  states: (State[] | undefined)[],
  next: number,
  after: readonly State[],
): boolean {
  const known = states[next];
  const merged =
    known === undefined ? [...after] : known.map((state, r) => joined(state, after[r] ?? 'empty'));
  if (known !== undefined && merged.every((state, r) => state === known[r])) {
    return false;
  }
  states[next] = merged;
  return true;
}

/** Which registers the rules follow: neither borrowed nor a transient's. */
interface Registers {
  readonly transients: ReadonlySet<Register>;
  readonly tracked: (register: Register) => boolean;
}

/** The states after `subject` runs from `before`, and every rule it breaks there. */
function judged(
  code: CodeFunction,
  subject: Instruction,
  before: readonly State[],
  registers: Registers,
): {
  readonly after: State[];
  readonly found: readonly string[];
  readonly taken: { readonly after: State[]; readonly to: number } | undefined;
} {
  const after = [...before];
  const effect = effectOf(code, subject);
  const { tracked } = registers;
  const taken =
    effect.taken === undefined ? undefined : { after: [...before], to: effect.taken.to };
  const found = [
    ...operandsOf(subject)
      .read.filter((r) => tracked(r) && after[r] === 'empty' && !effect.letGo.includes(r))
      .map((r) => `reads register ${String(r)}, empty on every path.`),
    ...movedOut(effect.moved, after, tracked),
    ...letGoOf(effect.letGo, after, tracked),
    ...writtenOwning(effect.owned, after, registers),
    ...effect.borrowed.filter(tracked).map((r) => `borrows into owning register ${String(r)}.`),
    ...(subject.kind === 'return' || subject.kind === 'stopped' ? stillOwning(after, tracked) : []),
    ...(taken === undefined
      ? []
      : writtenOwning(effect.taken?.owned ?? none, taken.after, registers)),
  ];
  return { after, found, taken };
}

function movedOut(
  moved: readonly Register[],
  after: State[],
  tracked: (register: Register) => boolean,
): string[] {
  return moved.flatMap((register) => {
    const was = after[register];
    after[register] = 'empty';
    if (!tracked(register)) {
      return [`moves out of register ${String(register)}, which owns nothing.`];
    }
    return was === 'owning'
      ? []
      : [`moves out of register ${String(register)}, empty on some path.`];
  });
}

function letGoOf(
  letGo: readonly Register[],
  after: State[],
  tracked: (register: Register) => boolean,
): string[] {
  return letGo.flatMap((register) => {
    after[register] = 'empty';
    return tracked(register)
      ? []
      : [`lets go of register ${String(register)}, which owns nothing.`];
  });
}

function writtenOwning(
  owned: readonly Register[],
  after: State[],
  { transients, tracked }: Registers,
): string[] {
  return owned.flatMap((register) => {
    if (transients.has(register)) {
      return [];
    }
    if (!tracked(register)) {
      return [`writes an owned value into borrowed register ${String(register)}.`];
    }
    const was = after[register];
    after[register] = 'owning';
    return was === 'empty' ? [] : [`overwrites what register ${String(register)} owns.`];
  });
}

function stillOwning(after: readonly State[], tracked: (register: Register) => boolean): string[] {
  return after.flatMap((state, register) =>
    state !== 'empty' && tracked(register)
      ? [`ends the call while register ${String(register)} still owns its value.`]
      : [],
  );
}
