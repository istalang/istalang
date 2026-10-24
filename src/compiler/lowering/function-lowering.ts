/**
 * Lowering one function body into a code entry (docs/arch/definition.md, "Frames").
 *
 * - Registers are numbered as the frame lays them out: parameters first, then locals and
 *   temporaries, each a fresh register. Nothing is reused, so a register's meaning never changes
 *   within a function, which keeps the code easy to read back from a snapshot.
 * - A jump to a label not yet placed is patched when the label is placed, so code is emitted in a
 *   single pass.
 * - The body's value is returned at its end; a body ending in `return` leaves that last `return`
 *   unreachable but harmless, and the code always ends in one, as loading requires.
 */

import type { CodeFunction } from '../../definition/functions.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
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
import type { FunctionContext, Label, LoopTargets } from './context.ts';
import { expressionHandlers } from './expressions/expressions.ts';
import { lowerBlock, statementHandlers } from './statements/statements.ts';
import type { ConstantValue, DefinitionTables } from './tables.ts';

export class FunctionLowering implements FunctionContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly module: ModuleId;
  readonly body: CheckedBody;
  readonly #instructions: Instruction[] = [];
  readonly #variables = new Map<Identifier, Register>();
  readonly #placed = new Map<number, number>();
  readonly #patches = new Map<number, ((position: number) => void)[]>();
  #registers = 0;
  #labels = 0;
  #loop: LoopTargets | undefined;

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
      this.declareVariable(parameter.node.name, this.allocate());
    }
    const result = this.block(block);
    this.emit({ kind: 'return', span: block.span, value: result });
    return {
      kind: 'code',
      ...this.tables.entryHeader(declaration),
      async: declaration.isAsync,
      parameters: parameters.map((parameter) => ({ reference: parameter.reference })),
      captures: 0,
      registers: this.#registers,
      cells: [],
      instructions: this.#instructions,
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

  allocate(): Register {
    const register = this.#registers;
    this.#registers += 1;
    return register;
  }

  emit(instruction: Instruction): void {
    this.#instructions.push(instruction);
  }

  constant(value: ConstantValue, span: Span): Register {
    const dst = this.allocate();
    this.emit({ kind: 'constant', span, dst, constant: this.tables.constant(value) });
    return dst;
  }

  variable(declaring: Identifier): Register {
    const register = this.#variables.get(declaring);
    if (register === undefined) {
      throw new Error(`'${declaring.text}' has no register; the checker let an unknown name by.`);
    }
    return register;
  }

  declareVariable(declaring: Identifier, register: Register): void {
    this.#variables.set(declaring, register);
  }

  newLabel(): Label {
    this.#labels += 1;
    return { id: this.#labels };
  }

  place(label: Label): void {
    const position = this.#instructions.length;
    this.#placed.set(label.id, position);
    for (const patch of this.#patches.get(label.id) ?? []) {
      patch(position);
    }
    this.#patches.delete(label.id);
  }

  jump(target: Label, span: Span): void {
    const instruction: Extract<Instruction, { kind: 'jump' }> = { kind: 'jump', span, target: 0 };
    this.emit(instruction);
    this.#refer(target, (position) => {
      instruction.target = position;
    });
  }

  branch(condition: Register, whenTrue: Label, whenFalse: Label, span: Span): void {
    const instruction: Extract<Instruction, { kind: 'branch' }> = {
      kind: 'branch',
      span,
      condition,
      whenTrue: 0,
      whenFalse: 0,
    };
    this.emit(instruction);
    this.#refer(whenTrue, (position) => {
      instruction.whenTrue = position;
    });
    this.#refer(whenFalse, (position) => {
      instruction.whenFalse = position;
    });
  }

  insideLoop(targets: LoopTargets, body: () => void): void {
    const outer = this.#loop;
    this.#loop = targets;
    try {
      body();
    } finally {
      this.#loop = outer;
    }
  }

  get loop(): LoopTargets | undefined {
    return this.#loop;
  }

  /** Sets a label's position into an instruction now, or when the label is placed. */
  #refer(label: Label, patch: (position: number) => void): void {
    const position = this.#placed.get(label.id);
    if (position === undefined) {
      this.#patches.set(label.id, [...(this.#patches.get(label.id) ?? []), patch]);
    } else {
      patch(position);
    }
  }
}
