/**
 * Lowering one code entry (docs/arch/definition.md, "Frames"): a function instance's, or a nested
 * function's; the FunctionContext every handler works through, composed of per-concern units.
 *
 * - The body is read through what owns it (instances.ts), a function instance or a top-level
 *   constant: its types are concrete, and its calls target the instances they close to.
 * - A value the checker fitted (§2) is converted and wrapped once it is computed (fits.ts), so no
 *   handler needs to know about fitting. An optional chain is lowered from its last link
 *   (optional-chains.ts); a link's handler only reads its target through `chains.target`.
 * - The body's value is returned at its end; a body ending in `return` leaves that last `return`
 *   unreachable but harmless, and the code always ends in one, as loading requires.
 * - The frame (frames.ts) is laid out as the Definition says: the parameters, in order, a pack's
 *   elements each one (packs.ts), then a closure's captures, then locals and temporaries. A
 *   variable living in a cell is listed in `cells`; a reference parameter's register holds the
 *   caller's reference, and a captured cell's register the cell its closure carries.
 * - A parameter with a pattern (§3.3) takes its argument whole, in a register of its own, named
 *   only by its `as` name; once the frame is laid out, the argument is taken apart into the
 *   pattern's names as a declaration's targets take its value (statements/variables.ts).
 * - A lambda or local function (§3.14) answers to its own name through the closure it runs,
 *   taken once at its entry (`currentClosure`).
 * - A default's entry takes the parameters before its own, and gives its default (§3.1, §3.3);
 *   a struct's or variant's fields are parameters of a function of their own
 *   (syntax/field-defaults.ts), so a field's default is one too.
 * - A start entry (boundary/starts.ts) is a function's own body compiled once more with its
 *   arguments arriving as `Json`, each decoded into its parameter, so a host-started instance runs
 *   as one execution of the function.
 * - Which body an entry reads, and its frame, are frames.ts's; an entry is lowered only through
 *   `instanceLowering` and `nestedLowering`, which put the two together.
 */

import type { CodeFunction } from '../../../definition/functions.ts';
import type { FunctionId, Register } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values.ts';
import { handlerOf } from '../../../structures/kind-table.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Entity } from '../../binder/entities.ts';
import type { Checker, SignatureParameter } from '../../checker/check.ts';
import type { CheckedBody, ValueSite } from '../../checker/surface/checked-body.ts';
import type { FieldRead, FieldReading } from '../../checker/surface/checked-field.ts';
import type { CheckedPattern } from '../../checker/surface/checked-pattern.ts';
import type {
  ImplicitRole,
  ResolvedCall,
  ResolvedSite,
} from '../../checker/surface/resolved-call.ts';
import type { Fit } from '../../checker/types/fitting/fit.ts';
import { substitute } from '../../checker/types/substitution.ts';
import type { Type } from '../../checker/types/type.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Expression, FieldHeader, Lambda } from '../../syntax/expressions/index.ts';
import type { Identifier, Invalid, NodeOf } from '../../syntax/node.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { Block, Statement } from '../../syntax/statements.ts';
import { writtenBodyOf } from '../bodies.ts';
import { type ClosedCall, closeCallWithin } from '../closed-calls.ts';
import { CodeWriter, type WrittenInstruction } from '../code-writer.ts';
import { emitConstant } from '../constants.ts';
import type { CodeContext, FunctionContext } from '../context.ts';
import { expressionHandlers } from '../expressions/expressions.ts';
import { tupleOf } from '../expressions/tuples.ts';
import {
  type BodyOwner,
  type FunctionInstance,
  type NestedInstance,
  ownerDeclaration,
  ownerSubstitution,
} from '../instances.ts';
import { OptionalChains } from '../optional-chains.ts';
import { packElements } from '../packs.ts';
import { HoldScopes } from '../statements/holds.ts';
import { LoopStack } from '../statements/loops.ts';
import { lowerBlock, lowerBody, lowerStatement } from '../statements/statements.ts';
import { bindTargets, declareVariable, VariableRegisters } from '../statements/variables.ts';
import type { DefinitionTables, EntryHeader } from '../tables.ts';
import { fittedValue } from './fits.ts';
import {
  defaultValueOf,
  type Frame,
  instanceFrame,
  type LoweredFunction,
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

/** The lowering of a nested function's entry, read through its owner's body (§3.14). */
export function nestedLowering(
  lowering: Lowering,
  nested: NestedInstance,
  startHeader?: EntryHeader,
): FunctionLowering {
  const lowered = loweredNested(lowering, nested.owner);
  return new FunctionLowering(lowered, nestedFrame(lowered, nested, startHeader));
}

/** A parameter of a frame, with the element types it takes as parameters when it is a pack's. */
interface FrameSlot {
  readonly parameter: SignatureParameter;
  readonly elements: readonly Type[] | undefined;
}

class FunctionLowering implements FunctionContext {
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
  /** The body as the pass of the field loops being lowered reads it, and what owns it so. */
  #reading: Pick<LoweredFunction, 'owner' | 'body'>;

  constructor(lowered: LoweredFunction, frame: Frame) {
    const { checker, tables, owner, body } = lowered;
    this.checker = checker;
    this.tables = tables;
    this.module = checker.moduleOf(ownerDeclaration(owner));
    this.#reading = { owner, body };
    this.frame = frame;
  }

  get body(): CheckedBody {
    return this.#reading.body;
  }

  get owner(): BodyOwner {
    return this.#reading.owner;
  }

  inFieldPass<Lowered>(header: FieldHeader, field: string, lower: () => Lowered): Lowered {
    const outer = this.#reading;
    const step = { header, field };
    this.#reading = {
      owner: { ...outer.owner, passes: [...(outer.owner.passes ?? []), step] },
      body: passBody(this.checker, outer.body, step),
    };
    try {
      return lower();
    } finally {
      this.#reading = outer;
    }
  }

  /** The code entry for a function instance, whose body is `block`. */
  lower(block: Block): CodeFunction {
    this.#declareFrame();
    this.code.emit({ kind: 'return', span: block.span, value: lowerBody(this, block) });
    return this.#entry();
  }

  /** The code entry for a lambda or local function of the owner (§3.14). */
  lowerNested(node: Lambda | FunctionDeclaration): CodeFunction {
    this.#declareFrame();
    const body =
      node.kind === 'Lambda' ? node.body : writtenBodyOf(this.checker.program, this.module, node);
    if (body === undefined) {
      unreachable(`The local function at ${node.span.from} has no body.`);
    }
    const value = body.kind === 'Block' ? lowerBody(this, body) : this.expression(body);
    this.code.emit({ kind: 'return', span: body.span, value });
    return this.#entry();
  }

  /** The start entry of a function whose body is `body` (a block, or a lambda's), with `edges`. */
  lowerStart(edges: StartEdges, body: Block | Expression): CodeFunction {
    const { span } = body;
    const arguments_ = this.frame.parameters.map(() => this.code.allocate());
    for (const [index, parameter] of this.frame.parameters.entries()) {
      const decode = edges.parameters[index];
      const json = arguments_[index];
      if (decode === undefined || json === undefined) {
        unreachable(`No edge for argument ${index} of a start entry.`);
      }
      const value = decode(this, json, span);
      const register = this.#declareArgument(parameter);
      this.code.emit({ kind: 'move', span, dst: register, src: value });
      this.#takeApart(parameter, register);
    }
    const { self } = this.frame;
    if (self !== undefined && edges.self !== undefined) {
      const src = this.constant(edges.self, self.span);
      this.#declareFilled(self, (dst) => ({ kind: 'move', span: self.span, dst, src }));
    }
    this.#declareOwnCall();
    const value = body.kind === 'Block' ? lowerBody(this, body) : this.expression(body);
    this.code.emit({ kind: 'return', span, value });
    return this.#entry();
  }

  /** A default's entry: the parameters before its own, then that parameter's default. */
  lowerDefault(instance: FunctionInstance): CodeFunction {
    const given = this.#declareFrame();
    const parameter = this.checker.parametersOf(instance.declaration)[given.length];
    if (parameter === undefined) {
      unreachable(`No parameter ${given.length} of ${instance.declaration.name.text}.`);
    }
    const defaultValue = defaultValueOf(parameter);
    const value = this.expression(defaultValue);
    this.code.emit({ kind: 'return', span: defaultValue.span, value });
    return this.#entry();
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

  /**
   * Declares the frame's variables in its layout's order: the parameters, each in a register of
   * its own and a pack's elements in one each, then the captures, then a nested function's own
   * name, then each pack's tuple, then the names patterns take apart of arguments; the parameters'
   * registers.
   */
  #declareFrame(): readonly Register[] {
    const packs: { readonly parameter: SignatureParameter; readonly elements: Register[] }[] = [];
    const taken: { readonly parameter: SignatureParameter; readonly register: Register }[] = [];
    const parameters = this.#slots().flatMap(({ parameter, elements: types }) => {
      if (types !== undefined) {
        const elements = types.map(() => this.code.allocate());
        packs.push({ parameter, elements });
        return elements;
      }
      if (!parameter.reference) {
        const register = this.#declareArgument(parameter);
        taken.push({ parameter, register });
        return [register];
      }
      const register = this.code.allocate();
      if (parameter.node.name !== undefined) {
        this.variables.declare(parameter.node.name, register);
      }
      return [register];
    });
    for (const { entity, type } of this.frame.captures) {
      declareVariable(this, entity.name, this.#concrete(type));
    }
    const { self } = this.frame;
    if (self !== undefined) {
      this.#declareFilled(self, (dst) => ({ kind: 'currentClosure', span: self.span, dst }));
    }
    this.#declareOwnCall();
    for (const { parameter, elements } of packs) {
      const { span } = parameter.node;
      const tuple = tupleOf(this, elements, span);
      const register = this.#declareArgument(parameter);
      this.code.emit({ kind: 'move', span, dst: register, src: tuple });
    }
    for (const { parameter, register } of taken) {
      this.#takeApart(parameter, register);
    }
    return parameters;
  }

  /**
   * A register for `parameter`'s argument: its name's variable, or, for a pattern alone, one with
   * no name, which lasts as the frame does.
   */
  #declareArgument(parameter: SignatureParameter): Register {
    const type = this.#concrete(parameter.type);
    const { name } = parameter.node;
    if (name !== undefined) {
      return declareVariable(this, name, type);
    }
    const register = this.code.allocate();
    this.variables.declareUnnamed(register);
    return register;
  }

  /** Takes the argument in `register` apart into `parameter`'s pattern's names, if it has one. */
  #takeApart(parameter: SignatureParameter, register: Register): void {
    if (parameter.node.pattern !== undefined) {
      bindTargets(this, parameter.node, register, parameter.node.span);
    }
  }

  /** The frame's parameters, a pack's with the element types it takes as parameters (packs.ts). */
  #slots(): readonly FrameSlot[] {
    this.#layout ??= this.frame.parameters.map((parameter) => ({
      parameter,
      elements:
        parameter.rest?.kind === 'pack' ? packElements(this.#concrete(parameter.type)) : undefined,
    }));
    return this.#layout;
  }

  /**
   * Declares the variable an async function reads its own call through (§7), when it reads it, in
   * the entry running its body: its call is no default's, which runs before the call starts.
   */
  #declareOwnCall(): void {
    const { isAsync, function: owner } = this.frame;
    const call = isAsync ? this.checker.bindings.ownCallOf(this.module, owner) : undefined;
    if (call !== undefined) {
      this.#declareFilled(call.name, (dst) => ({ kind: 'currentCall', span: owner.span, dst }));
    }
  }

  /** Declares `name` in a register of its own, written by the instruction `fill` makes. */
  #declareFilled(name: Identifier, fill: (dst: Register) => WrittenInstruction): void {
    const register = this.code.allocate();
    this.variables.declare(name, register);
    this.code.emit(fill(register));
  }

  /** `type` as the owner sees it: its type parameters substituted. */
  #concrete(type: Type): Type {
    return substitute(type, ownerSubstitution(this.owner), this.checker.typeRules);
  }

  #entry(): CodeFunction {
    const { header, isAsync, givesDefault, captures } = this.frame;
    const { tree } = programModule(this.checker.program, this.module);
    const { registers, instructions } = this.code.finish(tree);
    return {
      kind: 'code',
      ...header,
      async: isAsync,
      givesDefault,
      parameters: this.#slots().flatMap(({ parameter, elements }) =>
        elements === undefined
          ? [{ reference: parameter.reference }]
          : elements.map(() => ({ reference: false })),
      ),
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
