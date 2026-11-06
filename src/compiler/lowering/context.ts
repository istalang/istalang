/**
 * What lowering one function works through, as an interface, so the per-construct modules depend
 * on it and never on each other (the parser's and the checker's seam, again): expression and
 * statement handlers recurse through the context, and function-lowering/ wires them.
 *
 * Code is linear register code (docs/arch/definition.md, "Frames"). Every expression lowers to the
 * register that holds its value; a statement lowers to instructions alone. What lowering one body
 * keeps track of lives in per-concern units (the code written, variables' registers, hold scopes,
 * loops), so a feature adds a unit, not methods here.
 */

import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values/values.ts';
import type { Entity } from '../binder/entities.ts';
import type { Checker } from '../checker/check.ts';
import type { CheckedBody, ValueSite } from '../checker/surface/checked-body.ts';
import type { FieldRead, FieldReading } from '../checker/surface/checked-field.ts';
import type { CheckedPattern } from '../checker/surface/checked-pattern.ts';
import type { ImplicitRole, ResolvedCall, ResolvedSite } from '../checker/surface/resolved-call.ts';
import type { Fit } from '../checker/types/fitting/fit.ts';
import type { Type } from '../checker/types/type/index.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations/index.ts';
import type { Expression, FieldHeader, Lambda } from '../syntax/expressions/index.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { Block, Statement } from '../syntax/statements/index.ts';
import type { ClosedCall } from './calls/closed-calls.ts';
import type { CodeWriter } from './code-writer.ts';
import type { HoldScopes } from './statements/holds.ts';
import type { LoopStack } from './statements/loops.ts';
import type { VariableRegisters } from './statements/variables.ts';
import type { DefinitionTables } from './tables/tables.ts';
import type { OptionalChains } from './values/optionals.ts';

/**
 * What writing code takes, with or without a checked body behind it: the code written, the tables
 * it names, and the checker it asks about types. Code lowering writes with no syntax behind it
 * (boundary/) works through this alone, as do the helpers both kinds share.
 */
export type CodeContext = Pick<FunctionContext, 'checker' | 'tables' | 'code' | 'constant'>;

export interface FunctionContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly module: ModuleId;
  /** The body, as the passes of the field loops being lowered read it (§4). */
  readonly body: CheckedBody;
  /**
   * What the entry being lowered produces, which a `?` returns an `Err` of (§3.12): a lambda's or
   * local function's own, not its owner's.
   */
  readonly result: Type;
  /** Lowers `node`; the register holding its value, converted as the checker found (§2). */
  readonly expression: (node: Expression) => Register;
  /**
   * `value`, of `type`, given at `site`, converted as `fit` says (§2, §3.10, §3.14): the one place
   * a value the checker found converted is, whether an expression's, an assigned part's or a `Unit`
   * with no expression.
   */
  readonly fitted: (value: Register, type: Type, fit: Fit, site: ValueSite) => Register;
  /**
   * Runs `lower` reading the body as the pass of the field loop `header` heads that visits `field`
   * reads it (§4), its calls closed and its nested functions keyed in that pass; what it gives.
   */
  readonly inFieldPass: <Lowered>(
    header: FieldHeader,
    field: string,
    lower: () => Lowered,
  ) => Lowered;
  /** Lowers a block; the register holding its value (unit when it ends in a statement). */
  readonly block: (node: Block) => Register;
  readonly statement: (node: Statement | Invalid) => void;
  readonly entityOf: (name: Identifier) => Entity | undefined;
  /** The type the checker found for `node`; lowering reads only what was checked. */
  readonly typeOf: (node: Expression) => Type;
  /** How the checker found the field read `access` reaches its field. */
  readonly fieldReadOf: (reading: FieldReading) => FieldRead;
  /** A `match` case's or `is`'s pattern as checked. */
  readonly patternOf: (pattern: Pattern) => CheckedPattern;
  /** The call the checker resolved at `site`, closed here (calls/closed-calls.ts). */
  readonly callAt: (site: ResolvedSite) => ClosedCall;
  /** `call`, one the checker recorded with no site, closed here. */
  readonly closed: (call: ResolvedCall) => ClosedCall;
  /** The call the checker made for `node` in `role`, closed here. */
  readonly implicitCallAt: (node: NodeOf<string>, role: ImplicitRole) => ClosedCall;
  /** The function-table entry of a lambda or local function in this body (§3.14). */
  readonly nestedIndex: (node: Lambda | FunctionDeclaration) => FunctionId;
  /** A fresh register holding the constant `value`. */
  readonly constant: (value: Value, span: AnchoredSpan) => Register;
  /** The function's code: registers, instructions and labels. */
  readonly code: CodeWriter;
  readonly variables: VariableRegisters;
  readonly holds: HoldScopes;
  readonly loops: LoopStack;
  readonly chains: OptionalChains;
}
