/**
 * One flow function under construction (../flow-ir.ts): its values, its blocks and the block code
 * is added to now, the scopes whose variables end with them, and where each `break` and `continue`
 * goes. The construct tables (expressions.ts, statements.ts, …) say what each construct adds; this
 * module owns the graph's shape.
 *
 * - Code is added to the current block. Once it has ended (a `return`, an exit, a stop), code built
 *   after it goes in a fresh block nothing jumps to, so it is still built, as code no path reaches.
 * - A scope is a block, a loop's pass or a case: it releases the variables declared in it where it
 *   ends and where an exit leaves it, innermost first; a `hold`'s variable is released by the scope
 *   it names instead, or by the function's `return`.
 * - The view of the body facts are read through changes inside a field loop's pass (`inView`):
 *   each pass reads the body as that pass checked it (§4).
 */

import type { VariableEntity } from '../../../../binder/entities.ts';
import type { ModuleId } from '../../../../program/program.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { Block, LabelledScope, Statement } from '../../../../syntax/statements/index.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import type { Identifier, Invalid, NodeOf } from '../../../../syntax/tree/node.ts';
import type { CheckerContext, ProgramInputs } from '../../../contexts/context.ts';
import type { CheckedBody } from '../../../surface/checked-body.ts';
import type { Type } from '../../../types/type/index.ts';
import type {
  BlockId,
  Exit,
  FlowBlock,
  FlowFunction,
  FlowValue,
  Operation,
  Place,
  ValueId,
} from '../flow-ir.ts';

/**
 * What building a body's flow reads: what names bind to, the parameters of the functions it calls,
 * and the bodies of the local functions it declares, of the body's module; and the body as checked.
 */
export interface FlowInputs {
  readonly checker: Pick<CheckerContext, 'bindings' | 'parametersOf'> & {
    readonly inputs: Pick<ProgramInputs, 'bodyOf'>;
  };
  readonly module: ModuleId;
  readonly body: CheckedBody;
}

/**
 * What each construct adds to a flow (index.ts assembles them): an expression's value, a
 * statement's operations, and a block's, with the value its tail gives.
 */
export interface Constructs {
  readonly expression: (builder: FlowBuilder, node: Expression) => ValueId;
  readonly statement: (builder: FlowBuilder, node: Statement | Invalid) => void;
  readonly block: (builder: FlowBuilder, node: Block) => ValueId | undefined;
}

/**
 * The optional chain (§4) whose links are being built: its links, the block its end meets at,
 * and the value it gives there, `none` where a link met none.
 */
export interface OpenChain {
  readonly links: ReadonlySet<Expression>;
  readonly end: BlockId;
  readonly result: ValueId;
}

/** A scope whose variables end with it: a block, a loop's pass, a case, or a labelled scope. */
/**
 * A scope whose variables end with it: a block, a loop's pass or a case; or the variables `hold`s
 * keep until a labelled scope ends (`holder`), which its `continue` leaves alone.
 */
interface Scope {
  readonly node: SyntaxNode;
  readonly holder?: LabelledScope;
  readonly variables: ValueId[];
}

/** Where an exit naming `scope` goes: past its end, or, for a loop, to its next pass. */
interface ExitTarget {
  readonly scope: LabelledScope;
  readonly breakTo: BlockId;
  readonly continueTo: BlockId | undefined;
  /** How many scopes were open outside it, which an exit leaving it ends. */
  readonly depth: number;
}

interface OpenBlock {
  readonly operations: Operation[];
  exit: Exit | undefined;
}

export class FlowBuilder {
  readonly inputs: FlowInputs;
  readonly root: SyntaxNode;
  readonly parameters: ValueId[] = [];
  readonly captures: ValueId[] = [];
  readonly #values: FlowValue[] = [];
  readonly #blocks: OpenBlock[] = [];
  readonly #variables = new Map<VariableEntity, ValueId>();
  readonly #globals = new Map<VariableEntity, ValueId>();
  readonly #scopes: Scope[] = [];
  readonly #exits: ExitTarget[] = [];
  readonly #constructs: Constructs;
  #body: CheckedBody;
  #current: BlockId;
  /** The optional chain whose links are being built, if any. */
  chain: OpenChain | undefined;

  constructor(inputs: FlowInputs, root: SyntaxNode, constructs: Constructs) {
    this.inputs = inputs;
    this.root = root;
    this.#constructs = constructs;
    this.#body = inputs.body;
    this.#current = this.newBlock();
  }

  /** `node`'s value, computed in the current block. */
  expression(node: Expression): ValueId {
    return this.#constructs.expression(this, node);
  }

  statement(node: Statement | Invalid): void {
    this.#constructs.statement(this, node);
  }

  /** `node`'s statements in a scope of their own, and the value its tail gives, if any. */
  block(node: Block): ValueId | undefined {
    return this.#constructs.block(this, node);
  }

  /** A builder of a function nested in this one, rooted at `root`, reading the same view. */
  nested(root: SyntaxNode): FlowBuilder {
    return new FlowBuilder({ ...this.inputs, body: this.#body }, root, this.#constructs);
  }

  /** The body's facts, as the pass being built reads them. */
  get body(): CheckedBody {
    return this.#body;
  }

  /** Runs `build` reading the body as `view`, a field loop's pass, reads it. */
  inView<Result>(view: CheckedBody, build: () => Result): Result {
    const outer = this.#body;
    this.#body = view;
    try {
      return build();
    } finally {
      this.#body = outer;
    }
  }

  /** The flow built: every block ended, the last one returning what reaches it. */
  finished(value: ValueId | undefined): FlowFunction {
    if (this.#open(this.#current).exit === undefined) {
      this.end({ kind: 'return', value, site: this.root });
    }
    return {
      root: this.root,
      parameters: this.parameters,
      captures: this.captures,
      values: this.#values,
      blocks: this.#blocks.map(
        ({ operations, exit }): FlowBlock => ({ operations, exit: exit ?? { kind: 'stop' } }),
      ),
    };
  }

  // Values.

  /** A temporary holding the value of `node`, of the type checking recorded for it. */
  temporaryOf(node: Expression): ValueId {
    return this.temporary(node, this.#body.typeOf(node));
  }

  /** A temporary computed at `site`, of `type`, undefined where checking recorded none. */
  temporary(site: NodeOf<string>, type: Type | undefined): ValueId {
    return this.#value({ kind: 'temporary', site, type });
  }

  /** The value of a variable the body declares, the same one wherever it is named. */
  variable(entity: VariableEntity): ValueId {
    const known = this.#variables.get(entity);
    if (known !== undefined) {
      return known;
    }
    const value = this.#value({
      kind: 'variable',
      entity,
      type: this.#body.declaredTypeOf(entity.name),
      inCell: this.#body.inCell(entity.name),
    });
    this.#variables.set(entity, value);
    return value;
  }

  /** A variable of an enclosing function this one captures, in the order captured. */
  captured(entity: VariableEntity, type: Type): ValueId {
    const value = this.#value({
      kind: 'variable',
      entity,
      type,
      inCell: this.#body.inCell(entity.name),
    });
    this.#variables.set(entity, value);
    this.captures.push(value);
    return value;
  }

  /** A value an enclosing function computed and this one captures, in the order captured. */
  capturedValue(type: Type | undefined, site: NodeOf<string>): ValueId {
    const value = this.temporary(site, type);
    this.captures.push(value);
    return value;
  }

  /** A top-level constant, extern constant or context constant named in the body. */
  global(entity: VariableEntity, type: Type | undefined): ValueId {
    const known = this.#globals.get(entity);
    if (known !== undefined) {
      return known;
    }
    const value = this.#value({ kind: 'global', entity, type });
    this.#globals.set(entity, value);
    return value;
  }

  /**
   * The value `place` holds now, read: a variable copied out of at its name, then the part its
   * path reaches.
   */
  valueAt(place: Place): ValueId {
    let value = place.root;
    if (this.valueOf(value).kind === 'variable') {
      const site = place.name ?? place.site;
      value = this.temporary(site, this.valueOf(place.root).type);
      this.emit({ op: 'copy', site, into: value, from: place.root, fit: undefined });
    }
    for (const part of place.path) {
      const read = this.temporary(place.site, undefined);
      this.emit({ op: 'read', site: place.site, into: read, from: value, part });
      value = read;
    }
    return value;
  }

  valueOf(id: ValueId): FlowValue {
    return this.#values[id] as FlowValue;
  }

  /** The variable `name` declares or names in the body; undefined for any other name. */
  entityOf(name: Identifier): VariableEntity | undefined {
    const entity = this.inputs.checker.bindings.entityOf(this.inputs.module, name);
    return entity?.kind === 'variable' ? entity : undefined;
  }

  #value(value: FlowValue): ValueId {
    this.#values.push(value);
    return this.#values.length - 1;
  }

  // Blocks.

  emit(operation: Operation): void {
    this.#open(this.#live()).operations.push(operation);
  }

  newBlock(): BlockId {
    this.#blocks.push({ operations: [], exit: undefined });
    return this.#blocks.length - 1;
  }

  /** Ends the current block with `exit`; what is built next goes in a block nothing jumps to. */
  end(exit: Exit): void {
    this.#open(this.#live()).exit = exit;
  }

  /** Goes on in `block`, jumping to it from the current one. */
  continueIn(block: BlockId): void {
    this.end({ kind: 'goto', to: block });
    this.#current = block;
  }

  /** Branches from the current block to `count` new ones, which it gives. */
  branch(count: number): readonly BlockId[] {
    const to = Array.from({ length: count }, () => this.newBlock());
    this.end({ kind: 'branch', to });
    return to;
  }

  /** Goes on in `block`, which something else jumps to. */
  resumeIn(block: BlockId): void {
    this.#current = block;
  }

  /** Runs each of `paths` from a branch of its own, then goes on where they all meet. */
  paths(paths: readonly (() => void)[]): void {
    const starts = this.branch(paths.length);
    const join = this.newBlock();
    for (const [index, start] of starts.entries()) {
      this.resumeIn(start);
      paths[index]?.();
      this.end({ kind: 'goto', to: join });
    }
    this.resumeIn(join);
  }

  /** The current block, or a new one nothing jumps to where it has ended. */
  #live(): BlockId {
    if (this.#open(this.#current).exit !== undefined) {
      this.#current = this.newBlock();
    }
    return this.#current;
  }

  #open(block: BlockId): OpenBlock {
    return this.#blocks[block] as OpenBlock;
  }

  // Scopes and exits.

  /** Runs `build` in a scope of `node`'s, releasing its variables where it ends. */
  inScope<Result>(node: SyntaxNode, build: () => Result): Result {
    this.#scopes.push({ node, variables: [] });
    const result = build();
    const scope = this.#scopes.pop() as Scope;
    this.#release(scope.variables, scope.node);
    return result;
  }

  /** `variable`, declared in the innermost scope, or held until `until` ends (§7). */
  declare(variable: ValueId, until?: LabelledScope | 'function'): void {
    if (until === 'function') {
      return;
    }
    const scope =
      until === undefined
        ? this.#scopes.at(-1)
        : this.#scopes.findLast((each) => each.holder === until);
    scope?.variables.push(variable);
  }

  /**
   * Runs `build` with `scope`'s exits going to `breakTo` and `continueTo`; what `hold`s keep until
   * it ends is released where it is left: at `breakTo`, which nothing has been built in yet, and
   * by any exit leaving it.
   */
  withExits<Result>(
    scope: LabelledScope,
    breakTo: BlockId,
    continueTo: BlockId | undefined,
    build: () => Result,
  ): Result {
    const depth = this.#scopes.length;
    this.#scopes.push({ node: scope, holder: scope, variables: [] });
    this.#exits.push({ scope, breakTo, continueTo, depth });
    const result = build();
    this.#exits.pop();
    const held = this.#scopes.pop() as Scope;
    if (held.variables.length > 0) {
      this.#open(breakTo).operations.unshift(released(held.variables, scope));
    }
    return result;
  }

  /**
   * An exit from `scope`: releases every scope inside it that it leaves, then goes past it, where
   * what `hold`s keep until it ends is released, or to its next pass, which keeps them.
   */
  exit(scope: LabelledScope | undefined, kind: 'break' | 'continue', site: SyntaxNode): void {
    const target = this.#exits.findLast((each) => each.scope === scope);
    if (target === undefined) {
      this.end({ kind: 'stop' });
      return;
    }
    for (const left of this.#scopes.slice(target.depth + 1).toReversed()) {
      this.#release(left.variables, site);
    }
    const to = kind === 'break' ? target.breakTo : target.continueTo;
    this.end(to === undefined ? { kind: 'stop' } : { kind: 'goto', to });
  }

  #release(variables: readonly ValueId[], site: SyntaxNode): void {
    if (variables.length > 0) {
      this.emit(released(variables, site));
    }
  }
}

function released(variables: readonly ValueId[], site: SyntaxNode): Operation {
  return { op: 'release', site, values: [...variables], reason: 'scope' };
}
