/**
 * Each instruction as one line of JavaScript (entry.ts), one emitter per kind.
 *
 * - **Registers are locals,** `r<n>`. A value is held as the runtime represents it in memory
 *   (definition/values/values.ts); a handle is the runtime object itself.
 * - **Holders** (docs/arch/definition.md, "Holders"): a register's lifetime class says what keeping
 *   one takes (definition/tables/types.ts `lifetimeOf`): a counted value is held and let go of by
 *   the runtime, which disposes what loses its last holder; a heap value is marked shared once it
 *   has a second holder, so a write changes it in place only while it has one; a plain value needs
 *   neither. A construction's new value is held by its register.
 * - **Places:** a step into a tuple is its `elements`, into a struct or variant its `fields`; the
 *   runtime writes along a path, copying each value it reaches that something else holds.
 * - Control goes through `pc` where the entry jumps (entry.ts); an entry running on its frame
 *   record (async today) saves its registers to it at a `park` and returns.
 */

import type { Instruction, InstructionOf } from '../definition/instructions/instruction.ts';
import type { Place } from '../definition/instructions/places.ts';
import type { Register } from '../definition/operands.ts';
import type { CodeFunction, FunctionDefinition } from '../definition/tables/functions.ts';
import type { TypeDefinition } from '../definition/tables/types.ts';
import { disposeOf, lifetimeOf } from '../definition/tables/types.ts';
import type { Value } from '../definition/values/values.ts';
import { type Handlers, handlerOf } from '../foundation/structures/kind-table.ts';
import { literal } from './literal.ts';
import { primitiveExpressions } from './primitives.ts';

/** What emitting one entry's instructions reads. */
export interface EntryScope {
  readonly index: number;
  readonly entry: CodeFunction;
  readonly functions: readonly FunctionDefinition[];
  readonly types: readonly TypeDefinition[];
  readonly constants: readonly Value[];
  /** Whether the entry runs on its frame record, saving its registers where it parks. */
  readonly onFrames: boolean;
  /** Whether control goes through `pc`: the entry jumps somewhere. */
  readonly jumps: boolean;
}

export const register = (index: Register): string => `r${index}`;

/** Goes on at `target`. */
function goTo(target: number): string {
  return `pc = ${target}; continue;`;
}

function lifetime(scope: EntryScope, index: Register) {
  const entry = scope.entry.registers[index];
  return entry === undefined || entry.borrowed ? 'plain' : lifetimeOf(scope.types, entry.type);
}

/** What keeping another holder of the value in `index` takes, as a statement. */
function held(scope: EntryScope, index: Register): string {
  switch (lifetime(scope, index)) {
    case 'counted':
      return ` hold(${register(index)});`;
    case 'heap':
      return ` share(${register(index)});`;
    default:
      return '';
  }
}

/** What a new value in `index` takes: its register holds it, when its holders are counted. */
function made(scope: EntryScope, index: Register): string {
  return lifetime(scope, index) === 'counted' ? ` hold(${register(index)});` : '';
}

/**
 * Empties the registers `moved` an instruction moved its value out of, where letting go of them
 * would count: their holder is now what the instruction made.
 */
function cleared(scope: EntryScope, moved: readonly Register[]): string {
  return moved
    .filter((each) => lifetime(scope, each) === 'counted')
    .map((each) => ` ${register(each)} = undefined;`)
    .join('');
}

/** The collection an append moved out of, when it writes into another register. */
function movedApart(i: { readonly dst: Register; readonly collection: Register }): Register[] {
  return i.collection === i.dst ? [] : [i.collection];
}

/** `dst = expression`, then what its holding takes. */
function assigned(dst: Register, expression: string, keep: string): string {
  return `${register(dst)} = ${expression};${keep}`;
}

/** The expression of constant `index`: a primitive inline, anything else the shared table's. */
function constantExpression(scope: EntryScope, index: number): string {
  const value = scope.constants[index];
  return value === null || typeof value !== 'object' ? literal(value) : `K[${index}]`;
}

/** A place's path as the runtime walks it: each step's property and position. */
function pathOf(place: Place): string {
  return literal(
    place.path.map((step) =>
      step.kind === 'tuple' ? ['elements', step.index] : ['fields', step.field],
    ),
  );
}

/** The helper writing a place, by its root's kind (runtime/run/places.ts). */
const storeHelpers = {
  register: 'storeRegister',
  cell: 'storeCell',
  reference: 'storeReference',
} as const satisfies Record<Place['root']['kind'], string>;

/** The expression a place's root is read by, as `load` and `reference` take it. */
function rootOf(place: Place): string {
  return `${literal(place.root.kind)}, ${register(place.root.register)}`;
}

/** The arguments of a call, an omitted one `undefined`. */
function argumentsOf(call: InstructionOf<'call'>): string {
  return call.arguments
    .map((argument) => (argument.kind === 'value' ? register(argument.register) : 'undefined'))
    .join(', ');
}

/** The expression calling the entry `index` with `passed`: as its kind is called. */
function callExpression(scope: EntryScope, index: number, passed: string): string {
  const callee = scope.functions[index];
  if (callee === undefined || callee.kind === 'extern') {
    return `x${index}(${passed})`;
  }
  return callee.mode === 'simple'
    ? `f${index}(${passed}${passed === '' ? '' : ', '}undefined)`
    : `start(${index}, [${passed}], undefined)`;
}

const emitters: Handlers<EntryScope, Instruction, [], string> = {
  constant: (scope, i) => assigned(i.dst, constantExpression(scope, i.constant), ''),
  move: (_, i) => `${register(i.dst)} = ${register(i.src)}; ${register(i.src)} = undefined;`,
  copy: (scope, i) => assigned(i.dst, register(i.src), held(scope, i.dst)),
  tuple: (scope, i) =>
    assigned(
      i.dst,
      `{ kind: 'tuple', elements: [${i.elements.map(register).join(', ')}] }`,
      made(scope, i.dst) + cleared(scope, i.elements),
    ),
  struct: (scope, i) =>
    assigned(
      i.dst,
      `{ kind: 'struct', type: ${i.type}, fields: [${i.fields.map(register).join(', ')}] }`,
      made(scope, i.dst) + cleared(scope, i.fields),
    ),
  variant: (scope, i) =>
    assigned(
      i.dst,
      `{ kind: 'variant', type: ${i.type}, variant: ${i.variant}, fields: [${i.fields.map(register).join(', ')}] }`,
      made(scope, i.dst) + cleared(scope, i.fields),
    ),
  array: (scope, i) => {
    const counted = lifetime(scope, i.dst) === 'counted';
    const items = i.elements.map((element) =>
      element.spread ? `...items(${register(element.value)}, ${counted})` : register(element.value),
    );
    const moved = i.elements.filter((element) => !element.spread).map((element) => element.value);
    return assigned(
      i.dst,
      `{ kind: 'array', elements: [${items.join(', ')}] }`,
      made(scope, i.dst) + cleared(scope, moved),
    );
  },
  map: (scope, i) => {
    const counted = lifetime(scope, i.dst) === 'counted';
    const entries = i.entries.map((entry) =>
      entry.kind === 'spread'
        ? `...entries(${register(entry.value)}, ${counted})`
        : `[${register(entry.key)}, ${register(entry.value)}]`,
    );
    const moved = i.entries.flatMap((entry) =>
      entry.kind === 'entry' ? [entry.key, entry.value] : [],
    );
    return assigned(
      i.dst,
      `mapOf([${entries.join(', ')}])`,
      made(scope, i.dst) + cleared(scope, moved),
    );
  },
  // The collection's holder becomes `dst`'s: the same value, or the copy `owned` made of it.
  append: (scope, i) =>
    assigned(
      i.dst,
      `append(${register(i.collection)}, ${register(i.item)})`,
      cleared(scope, [i.item, ...movedApart(i)]),
    ),
  appendEntry: (scope, i) =>
    assigned(
      i.dst,
      `appendEntry(${register(i.collection)}, ${register(i.key)}, ${register(i.value)}, ${lifetime(scope, i.dst) === 'counted'})`,
      cleared(scope, [i.key, i.value, ...movedApart(i)]),
    ),
  closure: (scope, i) =>
    assigned(
      i.dst,
      `{ kind: 'closure', function: ${i.function}, captures: [${i.captures.map(register).join(', ')}] }`,
      made(scope, i.dst) + cleared(scope, i.captures),
    ),
  currentClosure: (_, i) => `${register(i.dst)} = cl;`,
  tupleItem: (_, i) => `${register(i.dst)} = ${register(i.src)}.elements[${i.index}];`,
  structField: (_, i) => `${register(i.dst)} = ${register(i.src)}.fields[${i.field}];`,
  variantField: (_, i) => `${register(i.dst)} = ${register(i.src)}.fields[${i.field}];`,
  equal: (_, i) => `${register(i.dst)} = equal(${register(i.left)}, ${register(i.right)});`,
  not: (_, i) => `${register(i.dst)} = !${register(i.src)};`,
  order: (_, i) => {
    const operators = { less: '<', lessOrEqual: '<=', greater: '>', greaterOrEqual: '>=' };
    return `${register(i.dst)} = ${register(i.comparison)} ${operators[i.relation]} 0n;`;
  },
  primitive: (_, i) =>
    `${register(i.dst)} = ${primitiveExpressions[i.op](i.operands.map(register))};`,
  newCell: (scope, i) => {
    const counted = lifetime(scope, i.dst) === 'counted';
    const shared = scope.entry.instructions.some(
      (each) => each.kind === 'transient' && each.dst === i.dst,
    );
    const type = scope.entry.registers[i.dst]?.type;
    const dispose = type?.kind === 'named' ? disposeOf(scope.types, type.type) : undefined;
    const made_ = `${register(i.dst)} = cell(${register(i.value)}, ${counted}${dispose === undefined ? '' : `, ${dispose}`});${cleared(scope, [i.value])}`;
    return shared
      ? `${made_} shareTransient(${transientKey(scope, i.dst)}, ${register(i.dst)});`
      : made_;
  },
  load: (scope, i) => {
    const borrowed = scope.entry.registers[i.dst]?.borrowed === true;
    return assigned(
      i.dst,
      `load(${rootOf(i.place)}, ${pathOf(i.place)})`,
      borrowed ? '' : held(scope, i.dst),
    );
  },
  store: (scope, i) => {
    const counted = lifetime(scope, i.value) === 'counted';
    const written = `${storeHelpers[i.place.root.kind]}(${register(i.place.root.register)}, ${pathOf(i.place)}, ${register(i.value)}, ${counted})`;
    const done = cleared(scope, [i.value]);
    return i.place.root.kind === 'register'
      ? `${register(i.place.root.register)} = ${written};${done}`
      : `${written};${done}`;
  },
  reference: (_, i) => `${register(i.dst)} = reference(${rootOf(i.place)}, ${pathOf(i.place)});`,
  // A call sharing a transient shares it on too, so each call's `return` unshares its own.
  transient: (scope, i) => {
    const key = transientKey(scope, i.dst);
    const cell = register(i.dst);
    return `${cell} = transient(${key}); if (${cell} !== undefined) { shareTransient(${key}, ${cell}); ${goTo(i.target)} }`;
  },
  contextConstant: (scope, i) =>
    `${register(i.dst)} = contextConstant(${literal(i.name)}); if (${register(i.dst)} !== undefined) {${held(scope, i.dst)} ${goTo(i.target)} }`,
  makeContextConstant: (_, i) => `makeContextConstant(${literal(i.name)}, ${register(i.value)});`,
  jump: (_, i) => goTo(i.target),
  branch: (_, i) => `pc = ${register(i.condition)} ? ${i.whenTrue} : ${i.whenFalse}; continue;`,
  switch: (_, i) => {
    const otherwise = i.otherwise ?? i.targets.at(-1) ?? 0;
    return `pc = ${literal(i.targets)}[${register(i.value)}.variant] ?? ${otherwise}; continue;`;
  },
  return: (scope, i) => {
    const ended = transientEnds(scope);
    return scope.onFrames
      ? `${ended}return ${register(i.value)};`
      : `${ended}return ${register(i.value)};`;
  },
  unreachable: () => 'throw unreachableHere();',
  call: (scope, i) => {
    const passed = argumentsOf(i);
    const called =
      i.callee.kind === 'function'
        ? callExpression(scope, i.callee.function, passed)
        : `callValue(${register(i.callee.register)}, [${passed}])`;
    if (i.dst === undefined) {
      return `letGo(${called});`;
    }
    return `${register(i.dst)} = ${called};`;
  },
  currentCall: (scope, i) =>
    `${register(i.dst)} = ${scope.onFrames ? 'frame.execution' : 'currentExecution()'};`,
  given: (_, i) => `if (${register(i.parameter)} !== undefined) { ${goTo(i.target)} }`,
  mocked: (scope, i) => {
    const passed = i.arguments.map(register).join(', ');
    // The register holds an answer only where a mock gives one, never the marker of none.
    return `{ const answer = mocked(${scope.index}, [${passed}]); if (answer !== NOT_MOCKED) { ${register(i.dst)} = answer; ${goTo(i.landing)} } }`;
  },
  park: (scope, i) => {
    const saved = scope.entry.registers.map((_, index) => register(index)).join(', ');
    return `if (frame.stopping) { ${goTo(i.stop)} } frame.pc = ${parkResumeOf(scope, i)}; frame.registers = [${saved}]; return PARKED;`;
  },
  stopped: () => 'return STOPPED;',
  letGo: (scope, i) => {
    const counted = i.registers.filter((each) => lifetime(scope, each) === 'counted');
    const released = counted.length === 0 ? '' : `letGo(${counted.map(register).join(', ')}); `;
    return released + i.registers.map((each) => `${register(each)} = undefined;`).join(' ');
  },
};

/** The key a transient's cell is shared by: its function and register. */
function transientKey(scope: EntryScope, dst: Register): string {
  return literal(`${scope.index}:${dst}`);
}

/** Before a `return`: the transients this call shared stop being shared with calls nested later. */
function transientEnds(scope: EntryScope): string {
  return scope.entry.instructions
    .flatMap((each) =>
      each.kind === 'transient'
        ? [`unshareTransient(${transientKey(scope, each.dst)}, ${register(each.dst)}); `]
        : [],
    )
    .join('');
}

/**
 * The case a parked frame resumes at: one of its own past every instruction's (entry.ts), which
 * takes the decision, then falls into the instruction after the `park`.
 */
export function parkResumeOf(scope: EntryScope, park: InstructionOf<'park'>): number {
  return scope.entry.instructions.length + scope.entry.instructions.indexOf(park);
}

/** `instruction` of the entry `scope` emits, as a line. */
export function emitInstruction(scope: EntryScope, instruction: Instruction): string {
  return handlerOf(emitters, instruction)(scope, instruction);
}

/** The line a parked frame resumes at, which takes the position its wait was decided for. */
export function resumed(park: InstructionOf<'park'>): string {
  return `${register(park.dst)} = frame.decision; frame.decision = undefined; if (${register(park.dst)} === STOP) { ${goTo(park.stop)} }`;
}
