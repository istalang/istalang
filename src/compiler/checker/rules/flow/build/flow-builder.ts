/**
 * One flow function under construction (../../../surface/flow-ir.ts): its values, its blocks and
 * the block code is added to now. The construct tables (expressions.ts, statements.ts, …) say what
 * each construct adds, scopes.ts what is released where; this module owns the graph's shape.
 *
 * - Code is added to the current block. Once it has ended (a `return`, an exit, a stop), code built
 *   after it goes in a fresh block nothing jumps to, so it is still built, as code no path reaches.
 * - A name the body declares is one variable per function; any other name a global.
 * - The view the body's facts are read through changes inside a field loop's pass (`inView`):
 *   each pass reads the body as that pass checked it (§4).
 */

import type { VariableEntity } from '../../../../binder/entities.ts';
import type { ModuleId } from '../../../../program/program.ts';
import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import { placePath } from '../../../../syntax/expressions/places.ts';
import type { Block, Statement } from '../../../../syntax/statements/index.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import type { Identifier, Invalid, NodeOf } from '../../../../syntax/tree/node.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import type { CheckedBody } from '../../../surface/checked-body.ts';
import type { ConstantForm } from '../../../surface/constant-form.ts';
import type {
  BlockId,
  BranchTest,
  Computation,
  Exit,
  FlowBlock,
  FlowFunction,
  FlowValue,
  Operation,
  Place,
  ValueId,
} from '../../../surface/flow-ir.ts';
import type { Type } from '../../../types/type/index.ts';
import { Scopes } from './scopes.ts';

/**
 * What building a body's flow reads: what names bind to and the parameters of the functions it
 * calls, of the body's module; the bodies of the local functions it declares, which its tree holds
 * apart; and the body as checked.
 */
export interface FlowInputs {
  readonly checker: Pick<
    CheckerContext,
    | 'bindings'
    | 'parametersOf'
    | 'resultOf'
    | 'fieldsOf'
    | 'variantsOf'
    | 'fitOf'
    | 'typeRules'
    | 'wellKnownType'
  >;
  readonly module: ModuleId;
  readonly localBodyOf: (declaration: FunctionDeclaration) => Block | undefined;
  readonly body: CheckedBody;
}

/**
 * What each construct adds to a flow (index.ts assembles them): an expression's value, as it fits
 * where it is used or as computed, a statement's operations, and a block's, with its tail's value.
 */
export interface Constructs {
  readonly expression: (builder: FlowBuilder, node: Expression) => ValueId;
  readonly unfitted: (builder: FlowBuilder, node: Expression) => ValueId;
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

interface OpenBlock {
  readonly operations: Operation[];
  exit: Exit | undefined;
}

export class FlowBuilder {
  readonly inputs: FlowInputs;
  readonly root: SyntaxNode;
  /** What the function returns: its body's result; undefined where checking found none. */
  readonly result: Type | undefined;
  readonly parameters: ValueId[] = [];
  readonly captures: ValueId[] = [];
  readonly scopes = new Scopes({
    emit: (operation) => this.emit(operation),
    end: (exit) => this.end(exit),
    prepend: (block, operation) => this.#open(block).operations.unshift(operation),
  });
  readonly #values: FlowValue[] = [];
  readonly #blocks: OpenBlock[] = [];
  readonly #variables = new Map<VariableEntity, ValueId>();
  readonly #globals = new Map<VariableEntity, ValueId>();
  readonly #constructs: Constructs;
  #self: ValueId | undefined;
  #body: CheckedBody;
  #current: BlockId;
  /** The optional chain whose links are being built, if any. */
  chain: OpenChain | undefined;

  constructor(
    inputs: FlowInputs,
    root: SyntaxNode,
    constructs: Constructs,
    result: Type | undefined = inputs.body.result,
  ) {
    this.inputs = inputs;
    this.root = root;
    this.result = result;
    this.#constructs = constructs;
    this.#body = inputs.body;
    this.#current = this.newBlock();
  }

  /** `node`'s value, computed in the current block, as it fits where it is used. */
  expression(node: Expression): ValueId {
    return this.#constructs.expression(this, node);
  }

  /** `node`'s value as computed, before any conversion checking fitted it with. */
  unfitted(node: Expression): ValueId {
    return this.#constructs.unfitted(this, node);
  }

  statement(node: Statement | Invalid): void {
    this.#constructs.statement(this, node);
  }

  /** `node`'s statements in a scope of their own, and the value its tail gives, if any. */
  block(node: Block): ValueId | undefined {
    return this.#constructs.block(this, node);
  }

  /** A builder of a function nested in this one, rooted at `root`, returning `result`. */
  nested(root: SyntaxNode, result: Type | undefined): FlowBuilder {
    return new FlowBuilder({ ...this.inputs, body: this.#body }, root, this.#constructs, result);
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

  /** `value`, converted to the type expected of `node`, where checking fitted it to one. */
  fit(node: Expression, value: ValueId): ValueId {
    const expected = this.#body.expectedOf(node);
    if (expected === undefined || expected === this.#body.typeOf(node)) {
      return value;
    }
    const converted = this.temporary(node, expected);
    this.emit({
      op: 'copy',
      site: node,
      into: converted,
      from: value,
      fit: this.#body.fitAt(node),
    });
    return converted;
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
      self: this.#self,
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

  /** `computation` of `operands`, computed at `site` into `into`, which it gives. */
  compute(
    into: ValueId,
    site: NodeOf<string>,
    computation: Computation,
    operands: readonly ValueId[] = [],
  ): ValueId {
    this.emit({ op: 'compute', site, into, computation, operands });
    return into;
  }

  /** The value `form`, of `type`, made at `site`: a literal, an offset, `Unit`. */
  constant(site: NodeOf<string>, type: Type | undefined, form: ConstantForm): ValueId {
    return this.compute(this.temporary(site, type), site, { kind: 'constant', form });
  }

  /** The variable a name of the body declares, one value wherever it is named. */
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

  /** What `entity` names: a variable the body declares, or a global, of `type` if one. */
  named(entity: VariableEntity, type: Type | undefined): ValueId {
    if (this.#variables.has(entity) || this.#body.declaredTypeOf(entity.name) !== undefined) {
      return this.variable(entity);
    }
    const known = this.#globals.get(entity);
    if (known !== undefined) {
      return known;
    }
    const value = this.#value({ kind: 'global', entity, type });
    this.#globals.set(entity, value);
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

  /** `name`, the function's own name inside it, as the closure it runs as (§3.14). */
  ownName(name: Identifier, type: Type | undefined): void {
    const entity = this.entityOf(name);
    if (entity !== undefined) {
      const value = this.#value({ kind: 'variable', entity, type, inCell: false });
      this.#variables.set(entity, value);
      this.#self = value;
    }
  }

  /**
   * The value `place` holds now, read: a variable copied out of at its name, then the part its
   * path reaches, each read of the type of the expression it ends at, its place's last parts
   * being the last levels of the place its site names (places.ts).
   */
  valueAt(place: Place): ValueId {
    let value = place.root;
    if (this.valueOf(value).kind === 'variable') {
      const site = place.name ?? place.site;
      value = this.temporary(site, this.valueOf(place.root).type);
      this.emit({ op: 'copy', site, into: value, from: place.root, fit: undefined });
    }
    const { root, steps } = placePath(place.site);
    const levels = [root, ...steps].slice(-place.path.length);
    for (const [index, part] of place.path.entries()) {
      const read = this.temporary(place.site, this.#body.typeOf(levels[index] as Expression));
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

  /** Branches from the current block on `test` to `count` new ones, which it gives. */
  branch(test: BranchTest, count = 2): readonly BlockId[] {
    const to = Array.from({ length: count }, () => this.newBlock());
    this.end({ kind: 'branch', test, to });
    return to;
  }

  /** Runs `then` from a branch where `test` holds, then goes on where it doesn't. */
  when(test: BranchTest, then: () => void): void {
    const [holds, otherwise] = this.branch(test) as [BlockId, BlockId];
    this.resumeIn(holds);
    then();
    this.continueIn(otherwise);
  }

  /** Goes on in `block`, which something else jumps to. */
  resumeIn(block: BlockId): void {
    this.#current = block;
  }

  /**
   * The value inside the optional `whole`, read into `into` at `site` where `whole` holds one; where
   * it is `none`, `absent` runs from a branch of its own, which goes on elsewhere or ends (§4).
   */
  presentOr(
    whole: ValueId,
    { site, into }: { readonly site: Expression; readonly into: ValueId },
    absent: () => void,
  ): void {
    const [present, none] = this.branch({ kind: 'present', value: whole }) as [BlockId, BlockId];
    this.resumeIn(none);
    absent();
    this.resumeIn(present);
    this.emit({ op: 'read', site, into, from: whole, part: { kind: 'inside' } });
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
}
