/**
 * The nodes the analysis of one flow function relates (../reach-state.ts), and what it knows of
 * each without running: its type, whether that may reach a disposable, which handles it may hold.
 *
 * - **Values** are the function's own (flow-ir.ts `FlowValue`), one node each, as in
 *   Genaim–Zanardini: a variable holds one object at a time, so a loop's object of this pass is
 *   never confused with the last pass's.
 * - **Cells:** a captured `let` (`inCell`) lives in a cell, a handle of its own beside the value.
 * - **Inputs** are what the function was called with (../summary.ts), kept apart from the variables
 *   that start as them, which code may assign; a captured `let`'s cell is its own input.
 * - **Paths** are the parts reads name from a variable, interned by root and part, so reading
 *   `self->slot` twice names one value until a write may change it (design.md §5.2).
 * - **Last uses:** a temporary used only in the block computing it ends after its last use there,
 *   so a statement's temporaries don't linger in the state.
 */

import type { VariableEntity } from '../../../../binder/entities.ts';
import type { Type } from '../../../types/type/index.ts';
import type { FlowFunction, Operation, Part, ValueId } from '../../flow/flow-ir.ts';
import type { NodeId } from '../reach-state.ts';
import type { Input } from '../summary.ts';
import type { HandleReach, Relevance } from '../type-reach.ts';

/** What the analysis reads of types: relevance, the handles a value may hold, a cell's type. */
export interface TypeFacts {
  readonly relevanceOf: (type: Type) => Relevance;
  readonly reachOf: (type: Type) => HandleReach;
  readonly cellOf: (type: Type) => Type;
}

/** One input: what it is, the node it is as given, and the value that starts as it. */
export interface InputSlot {
  readonly input: Input;
  readonly node: NodeId;
  readonly value: ValueId;
  readonly type: Type;
}

/** How a read reaches its part: through a handle's cell (or a future's value), or inside a value. */
export type ReadKind = 'through' | 'part';

export function readKindOf(part: Part): ReadKind {
  return part.kind === 'behind' || part.kind === 'given' ? 'through' : 'part';
}

/** A path node: the part `part` of what `root` holds. */
interface PathNode {
  readonly root: NodeId;
  readonly kind: ReadKind;
  readonly type: Type;
}

export class Nodes {
  readonly flow: FlowFunction;
  readonly #inputs: InputSlot[];
  readonly #facts: TypeFacts;
  readonly #size: number;
  /** How many inputs have nodes of their own, the cells' being theirs already. */
  readonly #owned: number;
  readonly #paths = new Map<string, NodeId>();
  readonly #globals: InputSlot[] = [];
  readonly #pathNodes = new Map<NodeId, PathNode>();
  readonly #relevance = new Map<NodeId, boolean>();
  readonly #lastUses: ReadonlyMap<Operation, readonly ValueId[]>;
  readonly #captured: ReadonlySet<ValueId>;

  constructor(flow: FlowFunction, facts: TypeFacts) {
    this.flow = flow;
    this.#facts = facts;
    this.#size = flow.values.length;
    this.#inputs = [...inputSlots(flow, this.#size)];
    this.#owned = this.#inputs.filter((slot) => slot.input.kind !== 'cell').length;
    this.#lastUses = lastUsesOf(flow);
    this.#captured = new Set(
      flow.blocks.flatMap(({ operations }) =>
        operations.flatMap((operation) =>
          operation.op === 'make' && operation.made.kind === 'closure' ? operation.parts : [],
        ),
      ),
    );
  }

  /**
   * Whether `value` lives in a cell: a `let` a closure of this body captures, or one this
   * function captured. A variable passed by `&` alone is in a cell for lowering, but no object
   * anything else holds.
   */
  isCell(value: ValueId): boolean {
    const found = this.flow.values[value];
    return (
      found?.kind === 'variable' &&
      found.inCell &&
      (this.#captured.has(value) || this.flow.captures.includes(value))
    );
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
    if (known !== undefined) {
      return known;
    }
    const named: InputSlot = {
      input: { kind: 'global', entity, type },
      node: -1 - this.#globals.length,
      value: -1,
      type,
    };
    this.#globals.push(named);
    this.#inputs.push(named);
    return named;
  }

  cell(value: ValueId): NodeId {
    return this.#size + value;
  }

  /** Whether `node` is a captured `let`'s cell. */
  isCellNode(node: NodeId): boolean {
    return node >= this.#size && node < 2 * this.#size;
  }

  /** The node of the part `part` of `root`'s value, read as `kind`, of type `type`. */
  path(root: NodeId, part: Part, kind: ReadKind, type: Type): NodeId {
    const key = `${root}/${JSON.stringify(part)}`;
    const known = this.#paths.get(key);
    if (known !== undefined) {
      return known;
    }
    const node = 2 * this.#size + this.#owned + this.#paths.size;
    this.#paths.set(key, node);
    this.#pathNodes.set(node, { root, kind, type });
    return node;
  }

  /** The path `node` is, if it is one. */
  pathOf(node: NodeId): PathNode | undefined {
    return this.#pathNodes.get(node);
  }

  /** The path nodes whose root is `root`. */
  pathsFrom(root: NodeId): readonly NodeId[] {
    return [...this.#pathNodes].flatMap(([node, path]) => (path.root === root ? [node] : []));
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
    return this.#pathNodes.get(node)?.type;
  }

  /** Whether `node`'s values may reach a disposable, as some instantiation may have them. */
  isRelevant(node: NodeId): boolean {
    const known = this.#relevance.get(node);
    if (known !== undefined) {
      return known;
    }
    const type = this.typeOf(node);
    const relevant = type !== undefined && this.#facts.relevanceOf(type) !== 'no';
    this.#relevance.set(node, relevant);
    return relevant;
  }

  relevanceOf(type: Type): Relevance {
    return this.#facts.relevanceOf(type);
  }

  reachOf(node: NodeId): HandleReach | undefined {
    const type = this.typeOf(node);
    return type === undefined ? undefined : this.#facts.reachOf(type);
  }

  /** The temporaries whose last use `operation` is. */
  endingAfter(operation: Operation): readonly ValueId[] {
    return this.#lastUses.get(operation) ?? [];
  }
}

function inputSlots(flow: FlowFunction, size: number): readonly InputSlot[] {
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
      ? [{ input: { kind: 'cell', index } as const, value, type: found.type, node: size + value }]
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
