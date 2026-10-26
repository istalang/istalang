/**
 * Lowering one code entry (docs/arch/definition.md, "Frames"): a function instance's, or a nested
 * function's; the FunctionContext every handler works through, composed of per-concern units.
 *
 * - The body is read through what owns it (instances.ts), a function instance or a top-level
 *   constant: its types are concrete, and its calls target the instances they close to.
 * - A value the checker fitted by the implicit wrap (§2) is wrapped here, once it is computed, so
 *   no handler needs to know about wrapping. An optional chain is lowered from its last link
 *   (optional-chains.ts); a link's handler only reads its target through `chains.target`.
 * - The body's value is returned at its end; a body ending in `return` leaves that last `return`
 *   unreachable but harmless, and the code always ends in one, as loading requires.
 * - The frame is laid out as the Definition says: the parameters, in order, then a closure's
 *   captures, then locals and temporaries. A variable living in a cell is listed in `cells`; a
 *   reference parameter's register holds the caller's reference, and a captured cell's register
 *   the cell its closure carries.
 * - A lambda or local function (§3.14) answers to its own name through the closure it runs,
 *   taken once at its entry (`currentClosure`).
 * - A defaults entry takes the arguments its callers give, computes the rest from the defaults
 *   (§3.3), each seeing the parameters before it, and calls the function with all of them, passing
 *   a reference parameter on as the reference it was given.
 * - A start entry (boundary/starts.ts) is a function's own body compiled once more with JSON at its
 *   edges: its arguments arrive as `Json` and are decoded into its parameters, and every return
 *   gives its value encoded, so a host-started instance runs as one execution of the function.
 */

import type { CodeFunction } from '../../definition/functions.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';
import { optionalVariants } from '../../language/well-known.ts';
import { handlerOf } from '../../structures/kind-table.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type {
  CallSite,
  CapturedVariable,
  CheckedBody,
  Checker,
  FunctionCall,
  ImplicitRole,
  NestedFunction,
  ResolvedCall,
  SignatureParameter,
} from '../checker/check.ts';
import { substitute, type Type } from '../checker/types/type.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Expression, Lambda } from '../syntax/expressions.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import { emitInbound, type Inbound } from './boundary/inbound.ts';
import { CodeWriter } from './code-writer.ts';
import type { FunctionContext } from './context.ts';
import { emitCall, referenceTo } from './emit-call.ts';
import { expressionHandlers } from './expressions/expressions.ts';
import { buildVariant } from './expressions/variants.ts';
import {
  type BodyOwner,
  calleeOf,
  type FunctionInstance,
  fullInstance,
  instanceOfCall,
  type NestedInstance,
  ownerDeclaration,
  ownerSubstitution,
} from './instances.ts';
import { OptionalChains } from './optional-chains.ts';
import { LoopStack } from './statements/loops.ts';
import { lowerBlock, lowerBody, lowerStatement } from './statements/statements.ts';
import { declareVariable, VariableRegisters } from './statements/variables.ts';
import type { DefinitionTables, EntryHeader } from './tables.ts';

/**
 * The JSON at a start entry's edges: how each argument is read from `Json`, a mismatch failing the
 * host's start; the call encoding what the entry gives; and the value a named lambda's own name
 * stands for there.
 */
export interface StartEdges {
  readonly parameters: readonly Inbound[];
  readonly outcome: FunctionCall;
  readonly self: Value | undefined;
}

/** What lowering an entry starts from: what owns its body, the body read through it, the tables. */
export interface LoweredFunction {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly owner: BodyOwner;
  readonly body: CheckedBody;
}

/**
 * The frame an entry's code runs in: what it is called, what it takes, what it captures and what
 * it produces.
 */
export interface Frame {
  readonly header: EntryHeader;
  readonly isAsync: boolean;
  readonly parameters: readonly SignatureParameter[];
  readonly captures: readonly CapturedVariable[];
  /** The function the entry runs: a top-level declaration, or a nested function. */
  readonly function: NestedFunction;
  /** `T` for an async entry returning `Future<T>`. */
  readonly result: Type;
  /** The name a nested function calls itself by. */
  readonly self: Identifier | undefined;
}

/**
 * The frame of a top-level function's instance, whose body `lowered` reads: the parameters its
 * callers give.
 */
export function instanceFrame(lowered: LoweredFunction, instance: FunctionInstance): Frame {
  const { checker, tables, body } = lowered;
  const { declaration, arity } = instance;
  const parameters = checker.parametersOf(declaration);
  return {
    header: tables.entryHeader(instance),
    isAsync: declaration.isAsync && arity === parameters.length,
    parameters: parameters.slice(0, arity),
    captures: [],
    function: declaration,
    result: body.result,
    self: undefined,
  };
}

/** The frame of a nested function, as `body`, its owner's, checked it. */
export function nestedFrame(
  tables: DefinitionTables,
  nested: NestedInstance,
  body: CheckedBody,
): Frame {
  const { node } = nested;
  const checked = body.functionOf(node);
  if (checked === undefined) {
    unreachable(`The function at ${node.span.start} was never checked.`);
  }
  const { type, parameters, captures } = checked;
  return {
    header: tables.nestedHeader(nested),
    isAsync: type.isAsync,
    parameters: parameters.map((parameter, index) => {
      const slot = type.parameters[index];
      if (slot === undefined) {
        unreachable(`'${parameter.name.text}' has no slot in its function's type.`);
      }
      return { node: parameter, ...slot };
    }),
    captures,
    function: node,
    result: type.result,
    self: node.name,
  };
}

export class FunctionLowering implements FunctionContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly module: ModuleId;
  readonly body: CheckedBody;
  readonly owner: BodyOwner;
  readonly frame: Frame;
  readonly code = new CodeWriter();
  readonly variables = new VariableRegisters();
  readonly loops = new LoopStack();
  readonly chains = new OptionalChains((node) => handlerOf(expressionHandlers, node)(this, node));
  /** What a start entry encodes its returns with; undefined for any other entry. */
  #outcome: FunctionCall | undefined;

  constructor(lowered: LoweredFunction, frame: Frame) {
    const { checker, tables, owner, body } = lowered;
    this.checker = checker;
    this.tables = tables;
    this.module = checker.moduleOf(ownerDeclaration(owner));
    this.owner = owner;
    this.body = body;
    this.frame = frame;
  }

  /** The code entry for a function instance, whose body is `block`. */
  lower(block: Block): CodeFunction {
    this.#declareFrame();
    this.returnValue(lowerBody(this, block), block.span);
    return this.#entry();
  }

  /** The code entry for a lambda or local function of the owner (§3.14). */
  lowerNested(node: Lambda | FunctionDeclaration): CodeFunction {
    this.#declareFrame();
    const { body } = node;
    if (body === undefined) {
      unreachable(`The local function at ${node.span.start} has no body.`);
    }
    this.returnValue(
      body.kind === 'Block' ? lowerBody(this, body) : this.expression(body),
      body.span,
    );
    return this.#entry();
  }

  /** The start entry of a function whose body is `body` (a block, or a lambda's), with `edges`. */
  lowerStart(edges: StartEdges, body: Block | Expression): CodeFunction {
    this.#outcome = edges.outcome;
    const { span } = body;
    const arguments_ = this.frame.parameters.map(() => this.code.allocate());
    for (const [index, parameter] of this.frame.parameters.entries()) {
      const edge = edges.parameters[index];
      const json = arguments_[index];
      if (edge === undefined || json === undefined) {
        unreachable(`No edge for argument ${index} of a start entry.`);
      }
      const path = this.constant(edge.path, span);
      const value = emitInbound(this, { json, path }, edge, span);
      const register = declareVariable(this, parameter.node.name, this.#concrete(parameter.type));
      this.code.emit({ kind: 'move', span, dst: register, src: value });
    }
    const { self } = this.frame;
    if (self !== undefined && edges.self !== undefined) {
      const src = this.constant(edges.self, self.span);
      this.#declareFilled(self, (dst) => ({ kind: 'move', span: self.span, dst, src }));
    }
    this.#declareOwnCall();
    this.returnValue(body.kind === 'Block' ? lowerBody(this, body) : this.expression(body), span);
    return this.#entry();
  }

  /** The defaults entry for `instance`: the given arguments, then the defaults, then the call. */
  lowerDefaults(instance: FunctionInstance): CodeFunction {
    const given = this.#declareFrame();
    const all = [...given];
    const { declaration } = instance;
    const parameters = this.checker.parametersOf(declaration);
    for (const parameter of parameters.slice(given.length)) {
      const { defaultValue } = parameter.node;
      if (defaultValue === undefined) {
        unreachable(
          `'${parameter.node.name.text}' has no default; the checker should have said so.`,
        );
      }
      const value = this.expression(defaultValue);
      const register = declareVariable(this, parameter.node.name, this.#concrete(parameter.type));
      this.code.emit({ kind: 'move', span: defaultValue.span, dst: register, src: value });
      all.push(register);
    }
    const result = emitCall(this, {
      span: declaration.name.span,
      callee: this.tables.functionIndex(fullInstance(this.checker, instance)),
      arguments: all.map((register, index) =>
        parameters[index]?.reference === true ? referenceTo(register) : register,
      ),
    });
    this.returnValue(result, declaration.name.span);
    return this.#entry();
  }

  expression(node: Expression): Register {
    let register =
      this.body.chainOf(node) === undefined
        ? handlerOf(expressionHandlers, node)(this, node)
        : this.chains.lower(this, node);
    let type = this.body.typeOf(node);
    for (let wraps = this.body.wrapsOf(node); wraps > 0; wraps -= 1) {
      const optional = this.checker.optionalOf(type);
      const some = { type: optional, name: optionalVariants.some };
      register = buildVariant(this, some, [register], node.span);
      type = optional;
    }
    return register;
  }

  get result(): Type {
    return this.frame.result;
  }

  nestedIndex(node: Lambda | FunctionDeclaration): FunctionId {
    return this.tables.nestedIndex({ owner: this.owner, node });
  }

  calleeIndex(site: CallSite): FunctionId {
    return this.#functionOf(this.body.calls.get(site), site);
  }

  implicitCallee(node: NodeOf<string>, role: ImplicitRole): FunctionId {
    return this.#functionOf(this.body.implicitCallOf(node, role), node);
  }

  #functionOf(resolved: ResolvedCall | undefined, at: NodeOf<string>): FunctionId {
    if (resolved === undefined) {
      unreachable(`No call was made for the ${at.kind} at ${at.span.start}.`);
    }
    return this.tables.functionIndex(calleeOf(resolved, this.owner));
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

  entityOf(name: Identifier): Entity | undefined {
    return this.checker.bindings.entityOf(this.module, name);
  }

  /**
   * Declares the frame's variables in its layout's order: the parameters, each in a register of
   * its own, then the captures, then a nested function's own name; the parameters' registers.
   */
  #declareFrame(): readonly Register[] {
    const parameters = this.frame.parameters.map((parameter) => {
      if (!parameter.reference) {
        return declareVariable(this, parameter.node.name, this.#concrete(parameter.type));
      }
      const register = this.code.allocate();
      this.variables.declare(parameter.node.name, register);
      return register;
    });
    for (const { entity, type } of this.frame.captures) {
      declareVariable(this, entity.name, this.#concrete(type));
    }
    const { self } = this.frame;
    if (self !== undefined) {
      this.#declareFilled(self, (dst) => ({ kind: 'currentClosure', span: self.span, dst }));
    }
    this.#declareOwnCall();
    return parameters;
  }

  /** Declares the variable an async function reads its own call through (§7), when it reads it. */
  #declareOwnCall(): void {
    const { isAsync, function: owner } = this.frame;
    const call = isAsync ? this.body.ownCallOf(owner) : undefined;
    if (call !== undefined) {
      this.#declareFilled(call.name, (dst) => ({ kind: 'currentCall', span: owner.span, dst }));
    }
  }

  /** Declares `name` in a register of its own, written by the instruction `fill` makes. */
  #declareFilled(name: Identifier, fill: (dst: Register) => Instruction): void {
    const register = this.code.allocate();
    this.variables.declare(name, register);
    this.code.emit(fill(register));
  }

  /** `type` as the owner sees it: its type parameters substituted. */
  #concrete(type: Type): Type {
    return substitute(type, ownerSubstitution(this.owner));
  }

  #entry(): CodeFunction {
    const { header, isAsync, parameters, captures } = this.frame;
    const { registers, instructions } = this.code.finish();
    return {
      kind: 'code',
      ...header,
      async: isAsync,
      parameters: parameters.map((parameter) => ({ reference: parameter.reference })),
      captures: captures.length,
      registers,
      cells: [...this.variables.cells],
      instructions,
    };
  }

  returnValue(value: Register, span: Span): void {
    const outcome = this.#outcome;
    const given =
      outcome === undefined
        ? value
        : emitCall(this, {
            span,
            callee: this.tables.functionIndex(instanceOfCall(outcome)),
            arguments: [value],
          });
    this.code.emit({ kind: 'return', span, value: given });
  }

  constant(value: Value, span: Span): Register {
    const dst = this.code.allocate();
    this.code.emit({ kind: 'constant', span, dst, constant: this.tables.constant(value) });
    return dst;
  }
}
