/**
 * What lowering one function works through, as an interface, so the per-construct modules depend
 * on it and never on each other (the parser's and the checker's seam, again): expression and
 * statement handlers recurse through the context, and function-lowering.ts wires them.
 *
 * Code is linear register code (docs/arch/definition.md, "Frames"). Every expression lowers to the
 * register that holds its value; a statement lowers to instructions alone. Jumps name labels, which
 * the context turns into instruction indexes once each label's place is known.
 */

import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { Register } from '../../definition/operands.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type { CheckedBody, Checker } from '../checker/check.ts';
import type { ModuleId } from '../program/program.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Identifier, Invalid } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { ConstantValue, DefinitionTables } from './tables.ts';

/** A place in the code, known once the code before it has been emitted. */
export interface Label {
  readonly id: number;
}

/** Where `break` and `continue` go inside a loop. */
export interface LoopTargets {
  readonly exit: Label;
  readonly next: Label;
}

export interface FunctionContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly module: ModuleId;
  readonly body: CheckedBody;
  /** Lowers `node`; the register holding its value. */
  readonly expression: (node: Expression) => Register;
  /** Lowers a block; the register holding its value (unit when it ends in a statement). */
  readonly block: (node: Block) => Register;
  readonly statement: (node: Statement | Invalid) => void;
  readonly entityOf: (name: Identifier) => Entity | undefined;
  /** A fresh register. */
  readonly allocate: () => Register;
  readonly emit: (instruction: Instruction) => void;
  /** A fresh register holding the constant `value`. */
  readonly constant: (value: ConstantValue, span: Span) => Register;
  /** The register a variable lives in, by its declaring name. */
  readonly variable: (declaring: Identifier) => Register;
  readonly declareVariable: (declaring: Identifier, register: Register) => void;
  readonly newLabel: () => Label;
  /** Places `label` at the next instruction. */
  readonly place: (label: Label) => void;
  readonly jump: (target: Label, span: Span) => void;
  readonly branch: (condition: Register, whenTrue: Label, whenFalse: Label, span: Span) => void;
  /** Lowers `body` as a loop's, with `break` and `continue` going to `targets`. */
  readonly insideLoop: (targets: LoopTargets, body: () => void) => void;
  readonly loop: LoopTargets | undefined;
}
