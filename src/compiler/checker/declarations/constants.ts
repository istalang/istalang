/**
 * Top-level constants (§3): values computable at compile time, which a Definition stores as
 * constants rather than code. ProgramChecker composes this unit and answers `constantOf` and
 * `constantNamed` through it.
 *
 * - A constant's initializer is checked like any expression, as a value of its own: its type is the
 *   annotation, which the initializer must fit, or else the initializer's own.
 * - One walk both decides what compile time computes and computes it (computation.ts), into a
 *   `ConstantForm` lowering only maps to a value. What it refuses is reported here.
 * - A constant is checked once, on first demand, and one defined through itself, directly or
 *   through others, is reported at every constant of the cycle (lazy-checks.ts).
 */

import type { ModuleId } from '../../program/program.ts';
import type { Expression } from '../../syntax/expressions.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import type { CheckedBody, CheckedConstant } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { LazyChecks } from '../lazy-checks.ts';
import { errorType, type Type } from '../types/type.ts';
import { computeConstant } from './computation.ts';

/** What ProgramChecker gives the unit: how to find a constant's module, and to check a value. */
export interface ConstantSeams {
  readonly checker: CheckerContext;
  /** The module whose top-level item `declaration` is; undefined for a local variable. */
  readonly moduleOfItem: (declaration: VariableDeclaration) => ModuleId | undefined;
  /** Checks `initializer` in `module` against `declared`, as a value of its own. */
  readonly checkValue: (
    module: ModuleId,
    initializer: Expression,
    declared: Type | undefined,
  ) => CheckedBody;
}

/** What a constant that has no value checks to: the error type, already reported. */
const uncomputed: CheckedConstant = { type: errorType, form: undefined };

export class ConstantChecks {
  readonly #seams: ConstantSeams;
  readonly #checks: LazyChecks<VariableDeclaration, CheckedConstant>;

  constructor(seams: ConstantSeams) {
    this.#seams = seams;
    this.#checks = new LazyChecks((member) => {
      const [name] = member.targets;
      const module = seams.moduleOfItem(member);
      if (name !== undefined && module !== undefined) {
        seams.checker.report(module, checkerDiagnostics.constantCycle(name.span, name.text));
      }
    });
  }

  /** The checked constant `declaration` declares; undefined when it isn't a top-level constant. */
  constantOf(declaration: VariableDeclaration): CheckedConstant | undefined {
    const module = this.#seams.moduleOfItem(declaration);
    if (module === undefined) {
      return undefined;
    }
    if (this.#checks.inCycle(declaration)) {
      return uncomputed;
    }
    return this.#checks.resultOf(declaration, () => this.#check(module, declaration));
  }

  /** The checked constant `name` denotes in `module`; undefined when it denotes anything else. */
  constantNamed(module: ModuleId, name: Identifier): CheckedConstant | undefined {
    const entity = this.#seams.checker.bindings.entityOf(module, name);
    return entity?.kind === 'variable' && entity.owner.kind === 'VariableDeclaration'
      ? this.constantOf(entity.owner)
      : undefined;
  }

  #check(module: ModuleId, declaration: VariableDeclaration): CheckedConstant {
    const { checker } = this.#seams;
    const [target, ...more] = declaration.targets;
    if (target === undefined || more.length > 0) {
      checker.unsupported(module, declaration, frontier.destructuring);
      return uncomputed;
    }
    const declared =
      declaration.type === undefined ? undefined : checker.resolveType(module, declaration.type);
    const checked = this.#seams.checkValue(module, declaration.initializer, declared);
    const outcome = computeConstant(declaration.initializer, {
      checked,
      fieldsOf: (type) => checker.fieldsOf(type),
      constantNamed: (name) => this.constantNamed(module, name),
    });
    if (outcome.kind === 'refused' && outcome.notYet !== undefined) {
      checker.unsupported(module, outcome.part, outcome.notYet);
    } else if (outcome.kind === 'refused') {
      checker.report(module, checkerDiagnostics.notConstant(outcome.part.span));
    }
    return { type: checked.result, form: outcome.kind === 'computed' ? outcome.form : undefined };
  }
}
