/**
 * Top-level constants (§3): values computable at compile time, which a Definition stores as
 * constants rather than code. ProgramChecker composes this unit and answers `constantOf` and
 * `constantNamed` through it.
 *
 * - A constant's initializer is checked like any expression, as a value of its own: its type is the
 *   annotation, which the initializer must fit, or else the initializer's own.
 * - Its targets take the value apart as a local declaration's do (patterns/walk.ts), so
 *   each name is a constant of its own: its part's type, and its part of the computed value.
 * - One walk both decides what compile time computes and computes it (rules/computation.ts), into a
 *   `ConstantForm` lowering only maps to a value. What it refuses is reported here. A lambda's
 *   form is lowered from the initializer's checking, which the unit keeps (`bodyOf`).
 * - A constant is checked once, on first demand, and one defined through itself, directly or
 *   through others, is reported at every constant of the cycle (lazy-checks.ts).
 */

import type { ModuleId } from '../../program/program.ts';
import type { Expression } from '../../syntax/expressions.ts';
import type { Identifier } from '../../syntax/node.ts';
import { targetNames } from '../../syntax/patterns.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import type { CheckedBody, CheckedConstant, TargetBinding } from '../check.ts';
import { formAt } from '../constant-form.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { LazyChecks } from '../lazy-checks.ts';
import { walkTargets } from '../patterns/walk.ts';
import { computeConstant, refusalOf } from '../rules/computation.ts';
import { errorType, type Type } from '../types/type.ts';

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

/**
 * A top-level declaration checked: its whole value, what each of its names binds, and its
 * initializer's checking, undefined for one never checked.
 */
interface CheckedDeclaration {
  readonly whole: CheckedConstant;
  readonly bindings: readonly TargetBinding[];
  readonly body: CheckedBody | undefined;
}

const unchecked: CheckedDeclaration = { whole: uncomputed, bindings: [], body: undefined };

export class ConstantChecks {
  readonly #seams: ConstantSeams;
  readonly #checks: LazyChecks<VariableDeclaration, CheckedDeclaration>;

  constructor(seams: ConstantSeams) {
    this.#seams = seams;
    this.#checks = new LazyChecks((member) => {
      const [name] = member.targets.flatMap(targetNames);
      const module = seams.moduleOfItem(member);
      if (name !== undefined && module !== undefined) {
        seams.checker.report(module, checkerDiagnostics.constantCycle(name.span, name.text));
      }
    });
  }

  /**
   * The whole value `declaration` checks to, before its targets take it apart; undefined when it
   * isn't a top-level constant.
   */
  constantOf(declaration: VariableDeclaration): CheckedConstant | undefined {
    return this.#checked(declaration)?.whole;
  }

  /** The checking of `declaration`'s initializer, which holds its lambdas (§3.14). */
  bodyOf(declaration: VariableDeclaration): CheckedBody | undefined {
    return this.#checked(declaration)?.body;
  }

  /** The checked constant `name` denotes in `module`; undefined when it denotes anything else. */
  constantNamed(module: ModuleId, name: Identifier): CheckedConstant | undefined {
    const entity = this.#seams.checker.bindings.entityOf(module, name);
    if (entity?.kind !== 'variable' || entity.owner.kind !== 'VariableDeclaration') {
      return undefined;
    }
    const checked = this.#checked(entity.owner);
    if (checked === undefined) {
      return undefined;
    }
    const binding = checked.bindings.find((each) => each.name === entity.name);
    const { form } = checked.whole;
    return binding === undefined
      ? uncomputed
      : { type: binding.type, form: form === undefined ? undefined : formAt(form, binding.path) };
  }

  #checked(declaration: VariableDeclaration): CheckedDeclaration | undefined {
    const module = this.#seams.moduleOfItem(declaration);
    if (module === undefined) {
      return undefined;
    }
    if (this.#checks.inCycle(declaration)) {
      return unchecked;
    }
    return this.#checks.resultOf(declaration, () => this.#check(module, declaration));
  }

  #check(module: ModuleId, declaration: VariableDeclaration): CheckedDeclaration {
    const { checker } = this.#seams;
    const declared =
      declaration.type === undefined ? undefined : checker.resolveType(module, declaration.type);
    const checked = this.#seams.checkValue(module, declaration.initializer, declared);
    const outcome = computeConstant(declaration.initializer, {
      checker,
      constant: declaration,
      checked,
      valueNamed: (name) => this.constantNamed(module, name),
    });
    if (outcome.kind === 'refused') {
      checker.report(module, refusalOf(outcome));
    }
    const bindings = walkTargets(
      {
        fieldsOf: (type) => checker.fieldsOf(type),
        entityOf: (name) => checker.bindings.entityOf(module, name),
        report: (diagnostic) => checker.report(module, diagnostic),
      },
      declaration.targets,
      checked.result,
    );
    const form = outcome.kind === 'computed' ? outcome.form : undefined;
    return { whole: { type: checked.result, form }, bindings, body: checked };
  }
}
