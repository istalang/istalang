/**
 * Lowering one function body into a code entry (docs/arch/definition.md, "Frames"): the
 * FunctionContext every handler works through, composed of per-concern units.
 *
 * The body's value is returned at its end; a body ending in `return` leaves that last `return`
 * unreachable but harmless, and the code always ends in one, as loading requires.
 */

import type { CodeFunction } from '../../definition/functions.ts';
import type { Register } from '../../definition/operands.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type { CheckedBody, Checker } from '../checker/check.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Expression } from '../syntax/expressions.ts';
import { handlerOf } from '../syntax/handlers.ts';
import type { Identifier, Invalid } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import { CodeWriter } from './code-writer.ts';
import type { FunctionContext } from './context.ts';
import { expressionHandlers } from './expressions/expressions.ts';
import { LoopStack } from './statements/loops.ts';
import { lowerBlock, statementHandlers } from './statements/statements.ts';
import { VariableRegisters } from './statements/variables.ts';
import type { ConstantValue, DefinitionTables } from './tables.ts';

export class FunctionLowering implements FunctionContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly module: ModuleId;
  readonly body: CheckedBody;
  readonly code = new CodeWriter();
  readonly variables = new VariableRegisters();
  readonly loops = new LoopStack();

  constructor(checker: Checker, tables: DefinitionTables, module: ModuleId, body: CheckedBody) {
    this.checker = checker;
    this.tables = tables;
    this.module = module;
    this.body = body;
  }

  /** The code entry for `declaration`, whose body is `block`. */
  lower(declaration: FunctionDeclaration, block: Block): CodeFunction {
    const parameters = this.checker.parametersOf(declaration);
    for (const parameter of parameters) {
      this.variables.declare(parameter.node.name, this.code.allocate());
    }
    const result = this.block(block);
    this.code.emit({ kind: 'return', span: block.span, value: result });
    const { registers, instructions } = this.code.finish();
    return {
      kind: 'code',
      ...this.tables.entryHeader(declaration),
      async: declaration.isAsync,
      parameters: parameters.map((parameter) => ({ reference: parameter.reference })),
      captures: 0,
      registers,
      cells: [],
      instructions,
    };
  }

  expression(node: Expression): Register {
    return handlerOf(expressionHandlers, node)(this, node);
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

  constant(value: ConstantValue, span: Span): Register {
    const dst = this.code.allocate();
    this.code.emit({ kind: 'constant', span, dst, constant: this.tables.constant(value) });
    return dst;
  }
}
