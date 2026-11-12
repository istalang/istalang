/**
 * Lowering one code entry (docs/arch/definition.md, "Frames"): a function instance's, or a nested
 * function's; the FunctionContext every handler works through, composed of per-concern units.
 *
 * - The body is read through what owns it (instances.ts), a function instance or a top-level
 *   constant: its types are concrete, and its calls target the instances they close to.
 * - A value the checker fitted (§2) is converted and wrapped once it is computed (fits/index.ts),
 *   so no handler needs to know about fitting. An optional chain is lowered from its last link
 *   (../values/optionals.ts); a link's handler only reads its target through `chains.target`.
 * - The body's value is returned at its end; a body ending in `return` leaves that last `return`
 *   unreachable but harmless, and the code always ends in one, as loading requires.
 * - The frame (frames.ts) is laid out as the Definition says, and its variables declared in that
 *   order (frame-variables.ts): the parameters, in order, a pack's elements each one (packs.ts),
 *   then a closure's captures, then locals and temporaries. A variable living in a cell is listed
 *   in `cells`; a reference parameter's register holds the caller's reference, and a captured
 *   cell's register the cell its closure carries.
 * - A parameter with a pattern (§3.3) takes its argument whole, in a register of its own, named
 *   only by its `as` name; once the frame is laid out, the argument is taken apart into the
 *   pattern's names as a declaration's targets take its value (constructs/statements/variables.ts).
 * - A lambda or local function (§3.14) answers to its own name through the closure it runs,
 *   taken once at its entry (`currentClosure`).
 * - An entry begins with its prologue, computing each parameter its call left out from its default
 *   (§3.1, §3.3, frame-variables.ts), read from the function's defaults (`inDefaults`); a struct's
 *   or variant's fields are parameters of a function of their own
 *   (syntax/declarations/field-defaults.ts), whose entry, with no body, builds the value from them
 *   (`lowerBuilt`, built-entries.ts), as an extern's computing its defaults calls the extern.
 * - A start entry (synthesized/boundary/starts.ts) is a function's own body compiled once more with
 *   its arguments arriving as `Json`, each decoded into its parameter, so a host-started instance
 *   runs as one execution of the function.
 * - Which body an entry reads, and its frame, are frames.ts's; an entry is lowered only through
 *   `instanceLowering` and `nestedLowering`, which put the two together.
 */

import type { FunctionId, Register } from '../../../definition/operands.ts';
import type { CodeFunction } from '../../../definition/tables/functions.ts';
import type { Value } from '../../../definition/values/values.ts';
import { handlerOf } from '../../../foundation/structures/kind-table.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Entity } from '../../binder/entities.ts';
import type { Checker } from '../../checker/check.ts';
import type { CheckedBody, ValueSite } from '../../checker/surface/checked-body.ts';
import type { FieldRead, FieldReading } from '../../checker/surface/checked-field.ts';
import type { CheckedPattern } from '../../checker/surface/checked-pattern.ts';
import type {
  ImplicitRole,
  ResolvedCall,
  ResolvedSite,
} from '../../checker/surface/resolved-call.ts';
import type { FunctionInstance } from '../../checker/surface/witness-closing.ts';
import type { Fit } from '../../checker/types/fitting/fit/index.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import type {
  ContextConstantDeclaration,
  FunctionDeclaration,
} from '../../syntax/declarations/index.ts';
import type { Expression, FieldHeader, Lambda } from '../../syntax/expressions/index.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import type { Block, Statement } from '../../syntax/statements/index.ts';
import type { Identifier, Invalid, NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { type ClosedCall, closeCallWithin } from '../calls/closed-calls.ts';
import { expressionHandlers } from '../constructs/expressions/expressions.ts';
import { HoldScopes } from '../constructs/statements/holds.ts';
import { LoopStack } from '../constructs/statements/loops.ts';
import { lowerBlock, lowerBody, lowerStatement } from '../constructs/statements/statements.ts';
import { VariableRegisters } from '../constructs/statements/variables.ts';
import type { CodeContext, FunctionContext } from '../context.ts';
import { emitConstant } from '../tables/constants.ts';
import {
  type BodyOwner,
  type DeferredPlan,
  type NestedInstance,
  ownerDeclaration,
} from '../tables/instances.ts';
import type { DefinitionTables, EntryHeader } from '../tables/tables.ts';
import { OptionalChains } from '../values/optionals.ts';
import { writtenBodyOf } from './bodies.ts';
import { CodeWriter } from './code-writer.ts';
import { fittedValue } from './fits/index.ts';
import {
  declareArgument,
  declareFilled,
  declareFrame,
  declareOwnCall,
  type EntryContext,
  type EntryParameter,
  type FrameSlot,
  frameSlots,
  takeApart,
} from './frame-variables.ts';
import {
  accessorFrame,
  type BodyReading,
  builtFrame,
  defaultsReading,
  type Frame,
  instanceFrame,
  type Lowering,
  loweredInstance,
  loweredNested,
  nestedFrame,
  passBody,
} from './frames.ts';

/** Decodes a start entry's JSON argument into its parameter's value. */
type StartParameterDecoder = (context: CodeContext, json: Register, span: AnchoredSpan) => Register;

/**
 * The JSON at a start entry's edges: how each argument is read from `Json`, a mismatch failing the
 * host's start, and the value a named lambda's own name stands for there.
 */
export interface StartEdges {
  readonly parameters: readonly StartParameterDecoder[];
  readonly self: Value | undefined;
}

/** The lowering of `instance`'s entry; undefined for an instance with no body, an extern. */
export function instanceLowering(
  lowering: Lowering,
  instance: FunctionInstance,
  startHeader?: EntryHeader,
): FunctionLowering | undefined {
  const lowered = loweredInstance(lowering, instance);
  return lowered === undefined
    ? undefined
    : new FunctionLowering(lowered, instanceFrame(lowered, instance, startHeader));
}

/**
 * The lowering of an entry built from `instance`'s parameters, which has no body of its own
 * (built-entries.ts); async when it awaits what it gives, `awaited`.
 */
export function builtLowering(
  lowering: Lowering,
  instance: FunctionInstance,
  awaited?: Type,
): FunctionLowering {
  const owner = { kind: 'function', instance } as const;
  return new FunctionLowering(
    { ...lowering, owner, body: undefined },
    builtFrame(lowering, instance, awaited),
  );
}

/** The lowering of the accessor of the context constant `declaration`, from its initializer (§3.4). */
export function accessorLowering(
  lowering: Lowering,
  declaration: ContextConstantDeclaration,
): FunctionLowering {
  const owner = { kind: 'contextConstant', declaration } as const;
  const body = lowering.checker.contextConstants.bodyOf(declaration);
  return new FunctionLowering(
    { ...lowering, owner, body },
    accessorFrame(lowering, declaration, body.result),
  );
}

/** The lowering of a nested function's entry, read through its owner's body (§3.14). */
export function nestedLowering(
  lowering: Lowering,
  nested: NestedInstance,
  startHeader?: EntryHeader,
): FunctionLowering {
  const lowered = loweredNested(lowering, nested.owner);
  return new FunctionLowering(lowered, nestedFrame(lowered, nested, startHeader));
}

class FunctionLowering implements EntryContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly module: ModuleId;
  readonly frame: Frame;
  readonly code = new CodeWriter();
  readonly variables = new VariableRegisters();
  readonly holds = new HoldScopes(this);
  readonly loops = new LoopStack();
  readonly chains = new OptionalChains((node) => handlerOf(expressionHandlers, node)(this, node));
  #layout: readonly FrameSlot[] | undefined;
  /**
   * The body as the prologue or the pass of the field loops being lowered reads it, and what owns
   * it so.
   */
  #reading: BodyReading;

  constructor(lowered: Lowering & BodyReading, frame: Frame) {
    const { checker, tables, owner, body } = lowered;
    this.checker = checker;
    this.tables = tables;
    this.module = checker.moduleOf(ownerDeclaration(owner));
    this.#reading = { owner, body };
    this.frame = frame;
  }

  get body(): CheckedBody {
    return this.#reading.body ?? unreachable(`${this.frame.header.name} has no body to read.`);
  }

  get owner(): BodyOwner {
    return this.#reading.owner;
  }

  inFieldPass<Lowered>(header: FieldHeader, field: string, lower: () => Lowered): Lowered {
    const { owner } = this.#reading;
    const step = { header, field };
    return this.#readingAs(
      {
        owner: { ...owner, passes: [...(owner.passes ?? []), step] },
        body: passBody(this.checker, this.body, step),
      },
      lower,
    );
  }

  inDefaults<Lowered>(lower: () => Lowered): Lowered {
    const { owner } = this.#reading;
    if (owner.kind !== 'function') {
      unreachable('Only a function instance has defaults to compute.');
    }
    return this.#readingAs(defaultsReading(this.checker, owner.instance), lower);
  }

  /** Runs `lower` reading `reading`, then reads what it read before; what `lower` gives. */
  #readingAs<Lowered>(reading: BodyReading, lower: () => Lowered): Lowered {
    const outer = this.#reading;
    this.#reading = reading;
    try {
      return lower();
    } finally {
      this.#reading = outer;
    }
  }

  /** The code entry for a function instance, whose body is `block`. */
  lower(block: Block): CodeFunction {
    const parameters = declareFrame(this, this.#slots());
    this.code.emit({ kind: 'return', span: block.span, value: lowerBody(this, block) });
    return this.#entry(parameters);
  }

  /**
   * The code entry for a function with no body of its own: its prologue, then what `build` makes
   * of its parameters, which it returns.
   */
  lowerBuilt(
    build: (context: FunctionContext, parameters: readonly EntryParameter[]) => Register,
  ): CodeFunction {
    const parameters = declareFrame(this, this.#slots());
    const value = build(this, parameters);
    this.code.emit({ kind: 'return', span: this.frame.function.span, value });
    return this.#entry(parameters);
  }

  /**
   * The code entry each read of a context constant calls (§3.4): the instance's value once made;
   * while it isn't, the initializer's, made the instance's value then, its temporaries let go of as
   * the entry returns. `name` keys it, as qualified.
   */
  lowerAccessor(declaration: ContextConstantDeclaration, name: string): CodeFunction {
    const parameters = declareFrame(this, this.#slots());
    const { span } = declaration;
    const value = this.code.allocate();
    const made = this.code.newLabel();
    this.code.contextConstant(value, name, made, span);
    this.code.emit({
      kind: 'move',
      span,
      dst: value,
      src: this.expression(declaration.initializer),
    });
    this.code.emit({ kind: 'makeContextConstant', span, name, value });
    this.code.place(made);
    this.code.emit({ kind: 'return', span, value });
    return this.#entry(parameters);
  }

  /** The code entry for a lambda or local function of the owner (§3.14). */
  lowerNested(node: Lambda | FunctionDeclaration): CodeFunction {
    const parameters = declareFrame(this, this.#slots());
    const body =
      node.kind === 'Lambda' ? node.body : writtenBodyOf(this.checker.program, this.module, node);
    if (body === undefined) {
      unreachable(`The local function at ${node.span.from} has no body.`);
    }
    const value = body.kind === 'Block' ? lowerBody(this, body) : this.expression(body);
    this.code.emit({ kind: 'return', span: body.span, value });
    return this.#entry(parameters);
  }

  /** The start entry of a function whose body is `body` (a block, or a lambda's), with `edges`. */
  lowerStart(edges: StartEdges, body: Block | Expression): CodeFunction {
    const { span } = body;
    const arguments_ = this.frame.parameters.map(() => this.code.allocate());
    const parameters = arguments_.map((register) => ({
      register,
      reference: false,
      hasDefault: false,
    }));
    for (const [index, parameter] of this.frame.parameters.entries()) {
      const decode = edges.parameters[index];
      const json = arguments_[index];
      if (decode === undefined || json === undefined) {
        unreachable(`No edge for argument ${index} of a start entry.`);
      }
      const value = decode(this, json, span);
      const register = declareArgument(this, parameter);
      this.code.emit({ kind: 'move', span, dst: register, src: value });
      takeApart(this, parameter, register);
    }
    const { self } = this.frame;
    if (self !== undefined && edges.self !== undefined) {
      const src = this.constant(edges.self, self.span);
      declareFilled(this, self, (dst) => ({ kind: 'move', span: self.span, dst, src }));
    }
    declareOwnCall(this);
    const value = body.kind === 'Block' ? lowerBody(this, body) : this.expression(body);
    this.code.emit({ kind: 'return', span, value });
    return this.#entry(parameters);
  }

  expression(node: Expression): Register {
    const stopsAt = this.body.stopsAt(node);
    if (stopsAt !== undefined) {
      for (const operand of stopsAt) {
        this.expression(operand);
      }
      return this.code.allocate();
    }
    const register =
      this.body.chainOf(node) === undefined
        ? handlerOf(expressionHandlers, node)(this, node)
        : this.chains.lower(this, node);
    return this.fitted(register, this.typeOf(node), this.body.fitAt(node), node);
  }

  fitted(value: Register, type: Type, fit: Fit, site: ValueSite): Register {
    return fittedValue(this, { value, type }, fit, { owner: this.owner, site });
  }

  get result(): Type {
    return this.frame.result;
  }

  nestedIndex(node: Lambda | FunctionDeclaration): FunctionId {
    return this.tables.nestedIndex({ owner: this.owner, node });
  }

  deferredIndex(plan: DeferredPlan): FunctionId {
    return this.tables.deferredIndex({ owner: this.owner, plan });
  }

  callAt(site: ResolvedSite): ClosedCall {
    return this.#closedAt(this.body.resolved.get(site), site);
  }

  implicitCallAt(node: NodeOf<string>, role: ImplicitRole): ClosedCall {
    return this.#closedAt(this.body.implicitCallOf(node, role), node);
  }

  closed(call: ResolvedCall): ClosedCall {
    return closeCallWithin(call, this.owner, this.checker);
  }

  #closedAt(resolved: ResolvedCall | undefined, at: NodeOf<string>): ClosedCall {
    return this.closed(checkedAt(resolved, at, 'call'));
  }

  typeOf(node: Expression): Type {
    return checkedAt(this.body.typeOf(node), node, 'type');
  }

  fieldReadOf(reading: FieldReading): FieldRead {
    return checkedAt(this.body.fieldReadOf(reading), reading, 'field read');
  }

  patternOf(pattern: Pattern): CheckedPattern {
    return checkedAt(this.body.patternOf(pattern), pattern, 'pattern');
  }

  block(node: Block): Register {
    return lowerBlock(this, node);
  }

  statement(node: Statement | Invalid): void {
    const waypoint =
      node.kind === 'Invalid' ? undefined : this.checker.annotations.waypointOf(this.module, node);
    this.code.withWaypoint(waypoint, () => {
      lowerStatement(this, node);
    });
  }

  /** What `name` denotes: the binder's answer. */
  entityOf(name: Identifier): Entity | undefined {
    return this.checker.bindings.entityOf(this.module, name);
  }

  /** The frame's parameters, laid out once for declaring them and for the entry's header. */
  #slots(): readonly FrameSlot[] {
    this.#layout ??= frameSlots(this);
    return this.#layout;
  }

  /** The finished entry, taking `parameters`. */
  #entry(parameters: readonly EntryParameter[]): CodeFunction {
    const { header, mode, captures } = this.frame;
    const { tree } = programModule(this.checker.program, this.module);
    const { registers, instructions } = this.code.finish(tree);
    return {
      kind: 'code',
      ...header,
      mode,
      parameters: parameters.map(({ reference, hasDefault }) => ({ reference, hasDefault })),
      captures: captures.length,
      registers,
      cells: [...this.variables.cells],
      instructions,
    };
  }

  constant(value: Value, span: AnchoredSpan): Register {
    return emitConstant(this, value, span);
  }
}

/** The checker's `answer` about `at`, which lowering reads only of what was checked. */
function checkedAt<T>(answer: T | undefined, at: NodeOf<string>, what: string): T {
  if (answer === undefined) {
    unreachable(`No ${what} was checked for the ${at.kind} at ${at.span.from}.`);
  }
  return answer;
}
