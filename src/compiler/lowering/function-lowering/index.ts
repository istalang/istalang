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
 * - The frame (frames.ts) is laid out as the Definition says: the parameters, in order, then a closure's
 *   captures, then locals and temporaries. A variable living in a cell is listed in `cells`; a
 *   reference parameter's register holds the caller's reference, and a captured cell's register
 *   the cell its closure carries.
 * - A lambda or local function (§3.14) answers to its own name through the closure it runs,
 *   taken once at its entry (`currentClosure`).
 * - A defaults entry takes the arguments its callers give, computes the rest from the defaults
 *   (§3.3), each seeing the parameters before it, and calls the function with all of them, passing
 *   a reference parameter on as the reference it was given. A field default's entry takes the
 *   fields before its field, and gives that field's default (§3.1, syntax/field-defaults.ts).
 * - A start entry (boundary/starts.ts) is a function's own body compiled once more with JSON at its
 *   edges: its arguments arrive as `Json` and are decoded into its parameters, and every return
 *   gives its value encoded, so a host-started instance runs as one execution of the function.
 */

import type { CodeFunction } from '../../../definition/functions.ts';
import type { Instruction } from '../../../definition/instructions/instruction.ts';
import type { FunctionId, Register } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values.ts';
import { optionalVariants } from '../../../language/well-known.ts';
import { handlerOf } from '../../../structures/kind-table.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Span } from '../../../text/span.ts';
import type { Entity } from '../../binder/entities.ts';
import type {
  CallSite,
  CheckedBody,
  Checker,
  FunctionCall,
  ImplicitRole,
  ResolvedCall,
  SignatureParameter,
} from '../../checker/check.ts';
import { substitute, type Type } from '../../checker/types/type.ts';
import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Expression, Lambda } from '../../syntax/expressions.ts';
import type { Identifier, Invalid, NodeOf } from '../../syntax/node.ts';
import type { Block, Statement } from '../../syntax/statements.ts';
import { emitInbound } from '../boundary/inbound.ts';
import { CodeWriter } from '../code-writer.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall, referenceTo } from '../emit-call.ts';
import { expressionHandlers } from '../expressions/expressions.ts';
import { buildVariant } from '../expressions/variants.ts';
import {
  type BodyOwner,
  calleeOf,
  type FunctionInstance,
  fullInstance,
  instanceOfCall,
  ownerDeclaration,
  ownerSubstitution,
} from '../instances.ts';
import { OptionalChains } from '../optional-chains.ts';
import { LoopStack } from '../statements/loops.ts';
import { lowerBlock, lowerBody, lowerStatement } from '../statements/statements.ts';
import { declareVariable, VariableRegisters } from '../statements/variables.ts';
import type { DefinitionTables } from '../tables.ts';
import type { Frame, LoweredFunction, StartEdges } from './frames.ts';

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
      const defaultValue = defaultValueOf(parameter);
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

  /** A field default's entry: the fields before field `arity`, then that field's default. */
  lowerFieldDefault(instance: FunctionInstance): CodeFunction {
    const given = this.#declareFrame();
    const field = this.checker.parametersOf(instance.declaration)[given.length];
    if (field === undefined) {
      unreachable(`No field ${given.length} of ${instance.declaration.name.text} has a default.`);
    }
    const defaultValue = defaultValueOf(field);
    this.returnValue(this.expression(defaultValue), defaultValue.span);
    return this.#entry();
  }

  expression(node: Expression): Register {
    const register =
      this.body.chainOf(node) === undefined
        ? handlerOf(expressionHandlers, node)(this, node)
        : this.chains.lower(this, node);
    return this.wrapped(register, this.body.typeOf(node), this.body.wrapsOf(node), node.span);
  }

  wrapped(value: Register, type: Type, wraps: number, span: Span): Register {
    let register = value;
    let current = type;
    for (let left = wraps; left > 0; left -= 1) {
      const optional = this.checker.optionalOf(current);
      const some = { type: optional, name: optionalVariants.some };
      register = buildVariant(this, some, [register], span);
      current = optional;
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

  callIndex(call: ResolvedCall): FunctionId {
    return this.tables.functionIndex(calleeOf(call, this.owner));
  }

  #functionOf(resolved: ResolvedCall | undefined, at: NodeOf<string>): FunctionId {
    if (resolved === undefined) {
      unreachable(`No call was made for the ${at.kind} at ${at.span.start}.`);
    }
    return this.callIndex(resolved);
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

  /** What `name` denotes: the binder's answer, unless it reads an async function's own call (§7). */
  entityOf(name: Identifier): Entity | undefined {
    return this.body.ownCallReadAt(name) ?? this.checker.bindings.entityOf(this.module, name);
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

/** The default of `parameter`, which every parameter a defaults entry computes has. */
function defaultValueOf(parameter: SignatureParameter): Expression {
  const { defaultValue } = parameter.node;
  if (defaultValue === undefined) {
    unreachable(`'${parameter.node.name.text}' has no default; the checker should have said so.`);
  }
  return defaultValue;
}
