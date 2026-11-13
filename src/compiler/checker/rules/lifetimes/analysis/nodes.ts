/**
 * The nodes the analysis of one flow function relates (../reach-state.ts), and what it knows of
 * each without running: its type, whether that may reach a disposable, which handles it may hold.
 *
 * - **Values** are the function's own (flow-ir.ts `FlowValue`), one node each, as in
 *   Genaim–Zanardini: a variable holds one object at a time, so a loop's object of this pass is
 *   never confused with the last pass's.
 * - **Cells:** a `let` captured or taken by `&` (`inCell`) lives in a cell, a handle of its own beside
 *   the value.
 * - **Inputs** are what the function was called with (../summary.ts), kept apart from the variables
 *   that start as them, which code may assign; a captured `let`'s cell is its own input. The
 *   globals it names, and what a watching handle may give (`watched`), are inputs from where it
 *   first names them on.
 * - **Nodes it makes:** a watched value as a call gives it (`watchedValue`), and what a default a
 *   call leaves out gives, each a value of the call alone.
 * - **Paths** are the parts reads name from a variable, interned by root and part, so reading
 *   `self->slot` twice names one value until a write may change it (design.md §5.2).
 * - **Last uses:** a temporary used only in the block computing it ends after its last use there,
 *   so a statement's temporaries don't linger in the state.
 * - **A value of no recorded type** (a temporary the IR's builder leaves untyped, such as a
 *   pattern's step or a loop's cursor step) is any value: it may reach a disposable, and anything
 *   at all, so the operations making it relate it as they would any other.
 */

import type { VariableEntity } from '../../../../binder/entities.ts';
import type { Type } from '../../../types/type/index.ts';
import type { FlowFunction, Operation, Part, ValueId } from '../../flow/flow-ir.ts';
import type { Input } from '../input.ts';
import type { NodeId } from '../reach-state.ts';
import { anyReach, type HandleReach, type Relevance } from '../type-reach.ts';

/** What the analysis reads of types: relevance, the handles a value may hold, a cell's type. */
export interface TypeFacts {
  readonly relevanceOf: (type: Type) => Relevance;
  readonly reachOf: (type: Type) => HandleReach;
  readonly knownReachOf: (type: Type) => HandleReach;
  readonly cellOf: (type: Type) => Type;
  /** A struct type's fields' names, in declaration order; undefined for another type. */
  readonly fieldNamesOf: (type: Type) => readonly string[] | undefined;
}

/**
 * One input: what it is, the node it is as given, the value that starts as it, and its type; none
 * for what a watching handle may give, which may be any value.
 */
export interface InputSlot {
  readonly input: Input;
  readonly node: NodeId;
  readonly value: ValueId;
  readonly type: Type | undefined;
}

/** How a read reaches its part: through a handle's cell (or a future's value), or inside a value. */
export type ReadKind = 'through' | 'part';

export function readKindOf(part: Part): ReadKind {
  return part.kind === 'behind' || part.kind === 'given' ? 'through' : 'part';
}

/** A path node: the part `part` of what `root` holds. */
interface PathNode {
  readonly root: NodeId;
  readonly part: Part;
  readonly kind: ReadKind;
  readonly type: Type;
}

export class Nodes {
  readonly flow: FlowFunction;
  /**
   * Whether findings may name parts of its inputs, not only its inputs (inputs.ts): not in a
   * recursive group, whose members name their inputs whole.
   */
  readonly inputParts: boolean;
  readonly #inputs: InputSlot[];
  readonly #facts: TypeFacts;
  readonly #size: number;
  /** How many inputs have nodes of their own, the cells' being theirs already. */
  readonly #owned: number;
  readonly #paths = new Map<string, NodeId>();
  /** How many nodes it made beyond its values, cells and inputs: paths and a call's own values. */
  #made = 0;
  readonly #madeTypes = new Map<NodeId, Type | undefined>();
  readonly #defaults = new Map<Operation, Map<number, NodeId>>();
  #watchedValue: NodeId | undefined;
  readonly #steps = new Map<object, number>();
  readonly #globals: InputSlot[] = [];
  readonly #pathNodes = new Map<NodeId, PathNode>();
  readonly #pathsByRoot = new Map<NodeId, NodeId[]>();
  readonly #relevance = new Map<NodeId, boolean>();
  readonly #lastUses: ReadonlyMap<Operation, readonly ValueId[]>;
  readonly #assigned: ReadonlySet<ValueId>;

  constructor(flow: FlowFunction, facts: TypeFacts, inputParts: boolean) {
    this.flow = flow;
    this.inputParts = inputParts;
    this.#facts = facts;
    this.#size = flow.values.length;
    this.#inputs = [...inputSlots(flow, this.#size, facts.cellOf)];
    this.#owned = this.#inputs.filter((slot) => slot.input.kind !== 'cell').length;
    this.#lastUses = lastUsesOf(flow);
    this.#assigned = new Set(
      flow.blocks.flatMap(({ operations }) =>
        operations.flatMap((operation) => ('into' in operation ? [operation.into] : [])),
      ),
    );
  }

  /**
   * Whether `value` lives in a cell: a `let` a closure captures or a call takes by `&` (`inCell`),
   * as lowering puts it in one. What holds the cell is what the analysis finds holds it.
   */
  isCell(value: ValueId): boolean {
    const found = this.flow.values[value];
    return found?.kind === 'variable' && found.inCell;
  }

  /** What the function was called with, and the globals it reaches through what it calls. */
  get inputs(): readonly InputSlot[] {
    return this.#inputs;
  }

  /** The input naming the global `entity`: the function's own, or one its callees name. */
  globalInput(entity: VariableEntity, type: Type): InputSlot {
    const known = this.#inputs.find(
      (slot) => slot.input.kind === 'global' && slot.input.entity === entity,
    );
    return known ?? this.#namedInput({ kind: 'global', entity, type }, type);
  }

  /** The input standing for what any handle watching values may give: one per function. */
  watchedInput(): InputSlot {
    const known = this.#inputs.find((slot) => slot.input.kind === 'watched');
    return known ?? this.#namedInput({ kind: 'watched' }, undefined);
  }

  #namedInput(input: Input, type: Type | undefined): InputSlot {
    const named: InputSlot = { input, node: -1 - this.#globals.length, value: -1, type };
    this.#globals.push(named);
    this.#inputs.push(named);
    return named;
  }

  /** Whether `node` stands for what any watching handle may give. */
  isWatched(node: NodeId): boolean {
    return this.#inputs.some((slot) => slot.input.kind === 'watched' && slot.node === node);
  }

  /**
   * The node a call makes of what a watching handle may give, as it relates it where it uses it: one
   * value of the call, ended after its use there.
   */
  watchedValue(): NodeId {
    this.#watchedValue ??= this.#allocate(undefined);
    return this.#watchedValue;
  }

  /** The node for what the default of the parameter at `index` gives, where `call` leaves it out. */
  defaultOf(call: Operation, index: number, type: Type | undefined): NodeId {
    const known = this.#defaults.get(call) ?? new Map<number, NodeId>();
    this.#defaults.set(call, known);
    const node = known.get(index) ?? this.#allocate(type);
    known.set(index, node);
    return node;
  }

  /** The nodes the defaults calls left out gave, which end with their calls. */
  defaults(): readonly NodeId[] {
    return [...this.#defaults.values()].flatMap((byIndex) => [...byIndex.values()]);
  }

  #allocate(type: Type | undefined): NodeId {
    const node = 2 * this.#size + this.#owned + this.#made;
    this.#made += 1;
    this.#madeTypes.set(node, type);
    return node;
  }

  cell(value: ValueId): NodeId {
    return this.#size + value;
  }

  /** Whether `value` is a parameter nothing assigns: it holds what the function was given. */
  isStable(value: ValueId): boolean {
    return this.flow.parameters.includes(value) && !this.#assigned.has(value);
  }

  /** Whether `node` is a captured `let`'s cell. */
  isCellNode(node: NodeId): boolean {
    return node >= this.#size && node < 2 * this.#size;
  }

  /** The node of the part `part` of `root`'s value, read as `kind`, of type `type`. */
  path(root: NodeId, part: Part, kind: ReadKind, type: Type): NodeId {
    const key = `${root}/${this.partKey(part)}`;
    const known = this.#paths.get(key);
    if (known !== undefined) {
      return known;
    }
    const node = this.#allocate(type);
    this.#paths.set(key, node);
    this.#pathNodes.set(node, { root, part, kind, type });
    const siblings = this.#pathsByRoot.get(root) ?? [];
    this.#pathsByRoot.set(root, [...siblings, node]);
    return node;
  }

  /**
   * What names a part, alike wherever it is read: a field by its name, which a member access, a
   * pattern and a generic's struct constraint name alike, a tuple's element by position, any other
   * part by its kind, and a step of its own kind (a union's member, an array pattern's) by itself.
   */
  partKey(part: Part): string {
    if (part.kind !== 'step') {
      return part.kind;
    }
    const { step } = part;
    if (typeof step === 'number') {
      return `#${step}`;
    }
    if (step.kind === 'field') {
      return `.${step.name}`;
    }
    let id = this.#steps.get(step);
    if (id === undefined) {
      id = this.#steps.size;
      this.#steps.set(step, id);
    }
    return `@${id}`;
  }

  /**
   * The parts a value made of `parts` (a struct of `type`, in its fields' declaration order, or a
   * tuple) has, each as a read names it: a field by its name.
   */
  madeParts(
    type: Type,
    parts: readonly NodeId[],
    kind: 'struct' | 'tuple',
  ): readonly (readonly [Part, NodeId])[] {
    if (kind === 'tuple') {
      return parts.map((part, index) => [{ kind: 'step', step: index }, part] as const);
    }
    const names = this.#facts.fieldNamesOf(type);
    if (names === undefined || names.length !== parts.length) {
      return [];
    }
    return parts.map(
      (part, index) =>
        [
          { kind: 'step', step: { kind: 'field', of: type, name: names[index] as string } },
          part,
        ] as const,
    );
  }

  /** The path `node` is, if it is one. */
  pathOf(node: NodeId): PathNode | undefined {
    return this.#pathNodes.get(node);
  }

  /** The path nodes whose root is `root`. */
  pathsFrom(root: NodeId): readonly NodeId[] {
    return this.#pathsByRoot.get(root) ?? [];
  }

  allPaths(): readonly NodeId[] {
    return [...this.#pathNodes.keys()];
  }

  typeOf(node: NodeId): Type | undefined {
    if (node < 0) {
      return this.#globals[-1 - node]?.type;
    }
    if (node < this.#size) {
      return this.flow.values[node]?.type;
    }
    if (node < 2 * this.#size) {
      const content = this.flow.values[node - this.#size]?.type;
      return content === undefined ? undefined : this.#facts.cellOf(content);
    }
    if (node < 2 * this.#size + this.#owned) {
      return this.#inputs[node - 2 * this.#size]?.type;
    }
    return this.#madeTypes.get(node);
  }

  /** Whether `node`'s values may reach a disposable, as some instantiation may have them. */
  isRelevant(node: NodeId): boolean {
    const known = this.#relevance.get(node);
    if (known !== undefined) {
      return known;
    }
    const type = this.typeOf(node);
    const relevant = type === undefined || this.#facts.relevanceOf(type) !== 'no';
    this.#relevance.set(node, relevant);
    return relevant;
  }

  relevanceOf(type: Type): Relevance {
    return this.#facts.relevanceOf(type);
  }

  reachOf(node: NodeId): HandleReach {
    const type = this.typeOf(node);
    return type === undefined ? anyReach : this.#facts.reachOf(type);
  }

  /** The temporaries whose last use `operation` is. */
  endingAfter(operation: Operation): readonly ValueId[] {
    return this.#lastUses.get(operation) ?? [];
  }
}

/** The function's inputs, a captured `let`'s cell typed as the cell it is (`cellOf`). */
function inputSlots(
  flow: FlowFunction,
  size: number,
  cellOf: (type: Type) => Type,
): readonly InputSlot[] {
  const slots: Omit<InputSlot, 'node'>[] = [];
  const slot = (input: Input, value: ValueId) => {
    const type = flow.values[value]?.type;
    if (type !== undefined) {
      slots.push({ input, value, type });
    }
  };
  for (const [index, value] of flow.parameters.entries()) {
    slot({ kind: 'parameter', index }, value);
  }
  for (const [index, value] of flow.captures.entries()) {
    slot({ kind: 'capture', index }, value);
  }
  if (flow.self !== undefined) {
    slot({ kind: 'self' }, flow.self);
  }
  const globals = new Set<unknown>();
  flow.values.forEach((value, index) => {
    if (value.kind === 'global' && !globals.has(value.entity)) {
      globals.add(value.entity);
      if (value.type !== undefined) {
        slot({ kind: 'global', entity: value.entity, type: value.type }, index);
      }
    }
  });
  const own = slots.map((each, index) => ({ ...each, node: 2 * size + index }));
  const cells = flow.captures.flatMap((value, index) => {
    const found = flow.values[value];
    return found?.kind === 'variable' && found.inCell && found.type !== undefined
      ? [
          {
            input: { kind: 'cell', index } as const,
            value,
            type: cellOf(found.type),
            node: size + value,
          },
        ]
      : [];
  });
  return [...own, ...cells];
}

/** For each operation, the temporaries used last there, of those used only in their own block. */
function lastUsesOf(flow: FlowFunction): ReadonlyMap<Operation, readonly ValueId[]> {
  const blockOf = new Map<ValueId, number>();
  const crossing = new Set<ValueId>();
  const last = new Map<ValueId, Operation>();
  flow.blocks.forEach((block, index) => {
    const note = (value: ValueId, at: Operation | undefined) => {
      if (flow.values[value]?.kind !== 'temporary') {
        return;
      }
      const defined = blockOf.get(value);
      if (defined === undefined) {
        blockOf.set(value, index);
      } else if (defined !== index) {
        crossing.add(value);
      }
      if (at === undefined) {
        crossing.add(value);
      } else {
        last.set(value, at);
      }
    };
    for (const operation of block.operations) {
      for (const value of operandsOf(operation)) {
        note(value, operation);
      }
      if ('into' in operation) {
        note(operation.into, operation);
      }
    }
    const { exit } = block;
    if (exit.kind === 'return' && exit.value !== undefined) {
      note(exit.value, undefined);
    }
  });
  const ending = new Map<Operation, ValueId[]>();
  for (const [value, at] of last) {
    if (!crossing.has(value)) {
      ending.set(at, [...(ending.get(at) ?? []), value]);
    }
  }
  return ending;
}

/** The values `operation` reads. */
function operandsOf(operation: Operation): readonly ValueId[] {
  const argumentValues = (
    each: Extract<Operation, { op: 'call' | 'callValue' }>['arguments'][number],
  ) => (each.kind === 'value' ? [each.value] : [each.place.root]);
  switch (operation.op) {
    case 'compute':
    case 'unknown':
      return operation.operands;
    case 'make':
      return operation.parts;
    case 'copy':
    case 'read':
      return [operation.from];
    case 'write':
      return [operation.place.root, operation.value];
    case 'call':
      return operation.arguments.flatMap(argumentValues);
    case 'callValue':
      return [operation.callee, ...operation.arguments.flatMap(argumentValues)];
    case 'suspend':
      return operation.awaited;
    case 'release':
      return operation.values;
    default: {
      const unhandled: never = operation;
      return unhandled;
    }
  }
}
