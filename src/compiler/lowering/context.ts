/**
 * What lowering one function works through, as an interface, so the per-construct modules depend
 * on it and never on each other (the parser's and the checker's seam, again): expression and
 * statement handlers recurse through the context, and function-lowering.ts wires them.
 *
 * Code is linear register code (docs/arch/definition.md, "Frames"). Every expression lowers to the
 * register that holds its value; a statement lowers to instructions alone. What lowering one body
 * keeps track of lives in per-concern units (the code written, variables' registers, loops), so a
 * feature adds a unit, not methods here.
 */

import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type { CallSite, CheckedBody, Checker, ImplicitRole } from '../checker/check.ts';
import type { ModuleId } from '../program/program.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { CodeWriter } from './code-writer.ts';
import type { LoopStack } from './statements/loops.ts';
import type { VariableRegisters } from './statements/variables.ts';
import type { DefinitionTables } from './tables.ts';

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
  /** The function-table entry the call at `site` targets. */
  readonly calleeIndex: (site: CallSite) => FunctionId;
  /** The function-table entry of the call the checker made for `node` in `role`. */
  readonly implicitCallee: (node: NodeOf<string>, role: ImplicitRole) => FunctionId;
  /** A fresh register holding the constant `value`. */
  readonly constant: (value: Value, span: Span) => Register;
  /** The function's code: registers, instructions and labels. */
  readonly code: CodeWriter;
  readonly variables: VariableRegisters;
  readonly loops: LoopStack;
}
