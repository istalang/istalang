/**
 * What lowering one entry works through, as an interface, so the modules writing its code depend
 * on it and never on each other: functions/ composes it, and a flow is written through it
 * (flow/writer.ts).
 *
 * Code is linear register code (docs/arch/definition.md, "Frames"). What a body runs and releases
 * is its flow's (checker surface/flow-ir.ts); what lowering one entry keeps track of beside it
 * lives in per-concern units (the code written, variables' registers).
 */

import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values/values.ts';
import type { Persistence } from '../../foundation/language/well-known/index.ts';
import type { Checker } from '../checker/check.ts';
import type { CheckedBody } from '../checker/surface/checked-body.ts';
import type { ResolvedCall } from '../checker/surface/resolved-call.ts';
import type { Fit } from '../checker/types/fitting/fit/index.ts';
import type { Substitution } from '../checker/types/parts/substitution.ts';
import type { Type } from '../checker/types/type/index.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations/index.ts';
import type { Lambda } from '../syntax/expressions/index.ts';
import type { NodeOf } from '../syntax/tree/node.ts';
import type { AnchoredSpan } from '../syntax/tree/positions.ts';
import type { ClosedCall } from './calls/closed-calls.ts';
import type { VariableRegisters } from './flow/variables.ts';
import type { CodeWriter } from './functions/code-writer.ts';
import type { FieldPassStep } from './tables/instances.ts';
import type { DefinitionTables } from './tables/tables.ts';

/**
 * What writing code takes, with or without a checked body behind it: the code written, the tables
 * it names, and the checker it asks about types. Code lowering writes with no syntax behind it
 * (synthesized/boundary/) works through this alone, as do the helpers both kinds share.
 */
export type CodeContext = Pick<
  FunctionContext,
  'checker' | 'tables' | 'code' | 'constant' | 'waitingMode'
>;

/** A value in a register, with its type, of the kind `Of` narrows it to. */
export interface TypedValue<Of extends Type = Type> {
  readonly register: Register;
  readonly type: Of;
}

/** What writing an entry takes beyond its code: the checker and the Definition's tables. */
export type Lowering = Pick<FunctionContext, 'checker' | 'tables'>;

export interface FunctionContext {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly module: ModuleId;
  /** The body the entry is written from: its flows, and what its prologue reads. */
  readonly body: CheckedBody;
  /**
   * `value`, of `type`, given at `site`, converted as `fit` says (§2, §3.10, §3.14): the one place
   * a value the checker found converted is.
   */
  readonly fitted: (value: Register, type: Type, fit: Fit, site: NodeOf<string>) => Register;
  /**
   * This context inside the field loops' `passes`, outermost first (§4): writing the same code, its
   * calls closed with their keys bound and its nested functions keyed there.
   */
  readonly inFieldPasses: (passes: readonly FieldPassStep[]) => FunctionContext;
  /** `call`, as the checker resolved it, closed here (calls/closed-calls.ts). */
  readonly closed: (call: ResolvedCall) => ClosedCall;
  /** The function-table entry of a lambda or local function in this body (§3.14). */
  readonly nestedIndex: (node: Lambda | FunctionDeclaration) => FunctionId;
  /** A fresh register of `type` owning the constant `value`. */
  readonly constant: (value: Value, type: Type, span: AnchoredSpan) => Register;
  /**
   * How the entry's types read its type parameters: its body's, the field loops it is in included,
   * or, for an entry with no body, its instance's (§3.5).
   */
  readonly substitution: () => Substitution;
  /** The kind of the entry's code, which only waits as live or ista code (proposal 8, Rule 2). */
  readonly waitingMode: () => Persistence;
  /** The entry's code: registers, instructions and labels. */
  readonly code: CodeWriter;
  readonly variables: VariableRegisters;
}
