/**
 * What lowering one function works through, as an interface, so the per-construct modules depend
 * on it and never on each other (the parser's and the checker's seam, again): expression and
 * statement handlers recurse through the context, and function-lowering/ wires them.
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
import type { Type } from '../checker/types/type.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Expression, Lambda } from '../syntax/expressions.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { CodeWriter } from './code-writer.ts';
import type { OptionalChains } from './optional-chains.ts';
import type { LoopStack } from './statements/loops.ts';
import type { VariableRegisters } from './statements/variables.ts';
import type { DefinitionTables } from './tables.ts';

/**
 * What writing code takes, with or without a checked body behind it: the code written, the tables
 * it names, and the checker it asks about types. Code lowering writes with no syntax behind it
 * (boundary/) works through this alone, as do the helpers both kinds share.
 */
export type CodeContext = Pick<FunctionContext, 'checker' | 'tables' | 'code'>;

export interface FunctionContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly module: ModuleId;
  readonly body: CheckedBody;
  /**
   * What the entry being lowered produces, which a `?` returns an `Err` of (§3.12): a lambda's or
   * local function's own, not its owner's.
   */
  readonly result: Type;
  /** Lowers `node`; the register holding its value, wrapped as the checker found (§2). */
  readonly expression: (node: Expression) => Register;
  /**
   * `value`, of `type`, wrapped into `Some` `wraps` times (§2): the one place a value the checker
   * found wrapped is, whether an expression's, an assigned part's or a `unit` with no expression.
   */
  readonly wrapped: (value: Register, type: Type, wraps: number, span: Span) => Register;
  /** Lowers a block; the register holding its value (unit when it ends in a statement). */
  readonly block: (node: Block) => Register;
  readonly statement: (node: Statement | Invalid) => void;
  readonly entityOf: (name: Identifier) => Entity | undefined;
  /** The function-table entry the call at `site` targets. */
  readonly calleeIndex: (site: CallSite) => FunctionId;
  /** The function-table entry of the call the checker made for `node` in `role`. */
  readonly implicitCallee: (node: NodeOf<string>, role: ImplicitRole) => FunctionId;
  /** The function-table entry of a lambda or local function in this body (§3.14). */
  readonly nestedIndex: (node: Lambda | FunctionDeclaration) => FunctionId;
  /** A fresh register holding the constant `value`. */
  readonly constant: (value: Value, span: Span) => Register;
  /**
   * Returns `value` from the entry: the one place its code returns, so a start entry gives what it
   * returns encoded as JSON (boundary/starts.ts).
   */
  readonly returnValue: (value: Register, span: Span) => void;
  /** The function's code: registers, instructions and labels. */
  readonly code: CodeWriter;
  readonly variables: VariableRegisters;
  readonly loops: LoopStack;
  readonly chains: OptionalChains;
}
