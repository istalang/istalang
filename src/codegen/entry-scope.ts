/**
 * What emitting one code entry's instructions reads of it: how each register is held, where its
 * labels jump and the JavaScript that reads and writes each register (docs/work/js-codegen/design.md,
 * "Functions").
 *
 * - A register is a JavaScript local `r<n>`. A cell register (a variable passed by `&`, captured
 *   by a closure, or a transient) holds a `Cell`, made by its first write; a reference parameter
 *   holds the caller's place as a `Place`. Reads and writes of both go through to what they hold, so
 *   instructions never ask how a register is held.
 * - A transient's cell becomes visible to the calls nested in this one as it is made
 *   (`run.share`), which is why its first write differs from any other cell register's.
 * - A counted register (definition/tables/functions.ts `counted`) reports its writes to the run's
 *   lifetimes (`lt`, live/lifetimes/): it holds what it is written and lets go of what it held. A
 *   cell's writes report themselves (live/values/cell.ts), and a reference holds nothing.
 * - Returning holds the value given back while every counted register lets go and what that let go
 *   of is collected (§7), then lets go of it for its taker to hold.
 */

import type { Place } from '../definition/instructions/places.ts';
import type { FunctionId, Label, Register } from '../definition/operands.ts';
import { type CodeFunction, transientRegistersOf } from '../definition/tables/functions.ts';
import { unreachable } from '../foundation/structures/unreachable.ts';

/** How a register holds what it holds. */
type Holding = 'value' | 'cell' | 'transient' | 'reference';

/** What every entry's code reads of the program it is in. */
export interface ProgramScope {
  /** The JavaScript function a direct call of entry `index` calls. */
  readonly functionName: (index: FunctionId) => string;
  /** Whether a write of an uncounted register checks it writes nothing counted (emit.ts). */
  readonly checksCounted: boolean;
}

export class EntryScope {
  readonly index: FunctionId;
  readonly entry: CodeFunction;
  readonly program: ProgramScope;
  /** Whether the entry runs as an execution of its own, an `async` function settling `fut`. */
  readonly async: boolean;
  /** Whether the entry shares transients, so it restores the execution it entered in as it returns. */
  readonly restoresExecution: boolean;
  /** The registers it counts, references aside, which its return and its stop let go of. */
  readonly counted: readonly Register[];
  readonly #holdings: readonly Holding[];
  readonly #countedSet: ReadonlySet<Register>;
  readonly #cellTypes: ReadonlyMap<Register, number>;

  constructor(index: FunctionId, entry: CodeFunction, program: ProgramScope) {
    this.index = index;
    this.entry = entry;
    this.program = program;
    this.async = entry.mode !== 'simple';
    this.restoresExecution = !this.async && transientRegistersOf(entry).length > 0;
    this.#holdings = holdingsOf(entry);
    this.counted = entry.counted.filter((register) => this.holding(register) !== 'reference');
    this.#countedSet = new Set(this.counted);
    this.#cellTypes = new Map(entry.cells.map(({ register, type }) => [register, type]));
  }

  /** Whether `register` is counted. */
  isCounted(register: Register): boolean {
    return this.#countedSet.has(register);
  }

  /**
   * Whether what decides the wait in `register` reaches nothing counted: every register an `await`
   * or a `select` of it takes the value into is uncounted.
   */
  waitsPlain(register: Register): boolean {
    return this.entry.instructions.every((instruction) => {
      if (instruction.kind === 'await' && instruction.wait === register) {
        return !this.isCounted(instruction.dst);
      }
      if (instruction.kind === 'select' && instruction.wait === register) {
        return instruction.cases.every(({ bind }) => bind === undefined || !this.isCounted(bind));
      }
      return true;
    });
  }

  /** The cell entry `register`'s cell is made as. */
  cellType(register: Register): number {
    return this.#cellTypes.get(register) ?? unreachable(`Register ${register} holds no cell.`);
  }

  /** The statement emptying `register`, letting go of what it held if it is counted. */
  emptied(register: Register): string {
    const name = `r${register}`;
    return this.isCounted(register)
      ? `lt.release(${name}); ${name} = undefined;`
      : `${name} = undefined;`;
  }

  /** The JavaScript function a direct call of entry `index` calls. */
  functionName(index: FunctionId): string {
    return this.program.functionName(index);
  }

  /**
   * The statements returning the value in `register`: an async function settles its future. What
   * the counted registers held is let go of and collected first, the value held meanwhile.
   */
  returned(register: Register): string {
    const value = this.read(register);
    const restore = this.restoresExecution ? ' run.at = entered;' : '';
    const back = this.async ? `run.settle(fut, t, ${!this.isCounted(register)}); ` : '';
    const give = this.async ? 'return;' : 'return t;';
    if (this.counted.length === 0) {
      return `t = ${value}; ${back}${restore} ${give}`;
    }
    const releases = this.counted.map((each) => this.emptied(each)).join(' ');
    return `t = ${value}; lt.hold(t); ${releases} ${collected} ${back}lt.release(t);${restore} ${give}`;
  }

  /** How `register` holds what it holds. */
  holding(register: Register): Holding {
    return this.#holdings[register] ?? 'value';
  }

  /** The expression reading `register`'s value. */
  read(register: Register): string {
    switch (this.holding(register)) {
      case 'value':
        return `r${register}`;
      case 'cell':
      case 'transient':
        return `r${register}.v`;
      case 'reference':
        return `r${register}.read()`;
      default:
        return unreachable('A holding with no read.');
    }
  }

  /** The statement writing `value`, an expression, to `register`. */
  write(register: Register, value: string): string {
    const name = `r${register}`;
    switch (this.holding(register)) {
      case 'value':
        if (this.isCounted(register)) {
          return `${name} = lt.swap(${name}, ${value});`;
        }
        return this.program.checksCounted
          ? `${name} = lt.uncounted(${value});`
          : `${name} = ${value};`;
      case 'cell':
        return `${name} = run.cellWrite(${name}, ${this.cellType(register)}, ${value});`;
      case 'transient':
        return `if (${name} === undefined) { ${name} = run.cellWrite(undefined, ${this.cellType(register)}, ${value}); run.share(${this.index}, ${register}, ${name}); } else ${name}.v = ${value};`;
      case 'reference':
        return `${name}.write(${value});`;
      default:
        return unreachable('A holding with no write.');
    }
  }

  /** What a closure captures of `register`: the cell itself, so writes are shared, else its value. */
  captured(register: Register): string {
    return this.holding(register) === 'value' ? `r${register}` : this.#heldCell(register);
  }

  /** The expression of `place` passed by `&`: a `Place`, a cell and a path into its value. */
  place({ register, path }: Place): string {
    const name = `r${register}`;
    if (this.holding(register) === 'reference') {
      return path.length === 0 ? name : `${name}.at(${JSON.stringify(path)})`;
    }
    return `placeIn(${this.#heldCell(register)}, ${JSON.stringify(path)})`;
  }

  /** The statement storing `value` at `place`, whose path isn't empty. */
  store({ register, path }: Place, value: string): string {
    const name = `r${register}`;
    const steps = JSON.stringify(path);
    switch (this.holding(register)) {
      case 'value':
        return this.write(register, `withPart(${name}, ${steps}, ${value})`);
      case 'reference':
        return `${name}.writeAt(${steps}, ${value});`;
      default:
        return `${name}.v = withPart(${name}.v, ${steps}, ${value});`;
    }
  }

  #heldCell(register: Register): string {
    const holding = this.holding(register);
    if (holding !== 'cell' && holding !== 'transient') {
      unreachable(`Register ${register} of ${this.entry.name} holds no cell.`);
    }
    return `r${register}`;
  }
}

function holdingsOf(entry: CodeFunction): Holding[] {
  const holdings: Holding[] = [];
  for (const { register } of entry.cells) {
    holdings[register] = 'cell';
  }
  for (const register of transientRegistersOf(entry)) {
    holdings[register] = 'transient';
  }
  for (const [index, parameter] of entry.parameters.entries()) {
    if (parameter.reference) {
      holdings[index] = 'reference';
    }
  }
  return holdings;
}

/** The statement collecting what lost its last holder, once something may have (§7). */
export const collected = 'if (lt.due) lt.collect();';

/** The statements going on at `label`. */
export function jump(label: Label): string {
  return `pc = ${label}; continue;`;
}
