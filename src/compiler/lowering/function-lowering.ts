/**
 * Lowering one function instance into a code entry (docs/arch/definition.md, "Frames"): the
 * FunctionContext every handler works through, composed of per-concern units.
 *
 * - The body is read through the instance (instances.ts): its types are concrete, and its calls
 *   target the instances they close to.
 * - A value the checker fitted by the implicit wrap (§2) is wrapped here, once it is computed, so
 *   no handler needs to know about wrapping.
 * - The body's value is returned at its end; a body ending in `return` leaves that last `return`
 *   unreachable but harmless, and the code always ends in one, as loading requires.
 * - A defaults entry takes the arguments its callers give, computes the rest from the defaults
 *   (§3.3), each seeing the parameters before it, and calls the function with all of them.
 */

import type { CodeFunction } from '../../definition/functions.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';
import { optionalVariants } from '../../language/well-known.ts';
import { handlerOf } from '../../structures/kind-table.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type { CallSite, CheckedBody, Checker } from '../checker/check.ts';
import type { ModuleId } from '../program/program.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Identifier, Invalid } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import { CodeWriter } from './code-writer.ts';
import type { FunctionContext } from './context.ts';
import { expressionHandlers } from './expressions/expressions.ts';
import { variantIndexOf } from './expressions/variants.ts';
import { calleeOf, type FunctionInstance, fullInstance } from './instances.ts';
import { LoopStack } from './statements/loops.ts';
import { lowerBlock, statementHandlers } from './statements/statements.ts';
import { VariableRegisters } from './statements/variables.ts';
import type { DefinitionTables } from './tables.ts';

export class FunctionLowering implements FunctionContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly module: ModuleId;
  readonly body: CheckedBody;
  readonly instance: FunctionInstance;
  readonly code = new CodeWriter();
  readonly variables = new VariableRegisters();
  readonly loops = new LoopStack();

  constructor(
    checker: Checker,
    tables: DefinitionTables,
    instance: FunctionInstance,
    body: CheckedBody,
  ) {
    this.checker = checker;
    this.tables = tables;
    this.module = checker.moduleOf(instance.declaration);
    this.instance = instance;
    this.body = body;
  }

  /** The code entry for the instance, whose body is `block`. */
  lower(block: Block): CodeFunction {
    this.#declareParameters();
    const result = this.block(block);
    this.code.emit({ kind: 'return', span: block.span, value: result });
    return this.#entry();
  }

  /** The defaults entry for the instance: the given arguments, then the defaults, then the call. */
  lowerDefaults(): CodeFunction {
    const given = this.#declareParameters();
    const all = [...given];
    const { declaration } = this.instance;
    for (const parameter of this.checker.parametersOf(declaration).slice(given.length)) {
      const { defaultValue } = parameter.node;
      if (defaultValue === undefined) {
        throw new Error(
          `'${parameter.node.name.text}' has no default; the checker should have said so.`,
        );
      }
      const register = this.expression(defaultValue);
      this.variables.declare(parameter.node.name, register);
      all.push(register);
    }
    const result = this.code.allocate();
    this.code.emit({
      kind: 'call',
      span: declaration.name.span,
      dst: result,
      callee: {
        kind: 'function',
        function: this.tables.functionIndex(fullInstance(this.checker, this.instance)),
      },
      arguments: all.map((register) => ({ kind: 'value', register })),
    });
    this.code.emit({ kind: 'return', span: declaration.name.span, value: result });
    return this.#entry();
  }

  expression(node: Expression): Register {
    let register = handlerOf(expressionHandlers, node)(this, node);
    let type = this.body.typeOf(node);
    for (let wraps = this.body.wrapsOf(node); wraps > 0; wraps -= 1) {
      const optional = this.checker.optionalOf(type);
      const dst = this.code.allocate();
      this.code.emit({
        kind: 'variant',
        span: node.span,
        dst,
        type: this.tables.typeIndex(optional),
        variant: variantIndexOf(this.checker, optional, optionalVariants.some),
        fields: [register],
      });
      register = dst;
      type = optional;
    }
    return register;
  }

  calleeIndex(site: CallSite): FunctionId {
    const resolved = this.body.calls.get(site);
    if (resolved === undefined) {
      throw new Error(`No call was resolved at ${site.span.start}.`);
    }
    return this.tables.functionIndex(calleeOf(resolved, this.instance));
  }

  block(node: Block): Register {
    return lowerBlock(this, node);
  }

  statement(node: Statement | Invalid): void {
    handlerOf(statementHandlers, node)(this, node);
  }

  entityOf(name: Identifier): Entity | undefined {
    return this.checker.bindings.entityOf(this.module, name);
  }

  /** Declares the parameters the instance takes, each in a register of its own; their registers. */
  #declareParameters(): readonly Register[] {
    const taken = this.checker
      .parametersOf(this.instance.declaration)
      .slice(0, this.instance.arity);
    return taken.map((parameter) => {
      const register = this.code.allocate();
      this.variables.declare(parameter.node.name, register);
      return register;
    });
  }

  #entry(): CodeFunction {
    const { declaration, arity } = this.instance;
    const { registers, instructions } = this.code.finish();
    return {
      kind: 'code',
      ...this.tables.entryHeader(this.instance),
      async: declaration.isAsync && arity === this.checker.parametersOf(declaration).length,
      parameters: this.checker
        .parametersOf(declaration)
        .slice(0, arity)
        .map((parameter) => ({ reference: parameter.reference })),
      captures: 0,
      registers,
      cells: [],
      instructions,
    };
  }

  constant(value: Value, span: Span): Register {
    const dst = this.code.allocate();
    this.code.emit({ kind: 'constant', span, dst, constant: this.tables.constant(value) });
    return dst;
  }
}
