/**
 * Top-level constants (§5.1): values computable at compile time, which a Definition stores as
 * constants rather than code. ProgramChecker composes this unit and answers `constantOf` and
 * `constantNamed` through it.
 *
 * - A constant's initializer is checked like any expression, as a value of its own: its type is the
 *   annotation, which the initializer must fit, or else the initializer's own.
 * - Its targets take the value apart as a local declaration's do
 *   (constructs/patterns/walk/index.ts), so each name is a constant of its own: its part's type,
 *   and its part of the computed value.
 * - One walk both decides what compile time computes and computes it (rules/computation/), into a
 *   `ConstantForm` lowering only maps to a value. What it refuses is reported here. A lambda's
 *   form is lowered from the initializer's checking, which the unit keeps (`bodyOf`).
 * - A constant is checked once, on first demand, and one defined through itself, directly or
 *   through others, is reported at every constant of the cycle, which all stand unchecked
 *   (foundation/structures/entries/); their initializers keep their checking.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import { targetNames } from '../../../syntax/patterns.ts';
import type { VariableDeclaration } from '../../../syntax/statements/index.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { CheckedConstant } from '../../check.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { computeConstant, refusalOf } from '../../rules/computation/index.ts';
import type { CheckedBody } from '../../surface/checked-body.ts';
import type { TargetBinding } from '../../surface/checked-pattern.ts';
import { formAt, sameForm } from '../../surface/constant-form.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';

/** What ProgramChecker gives the unit: how to find a constant's module, and to check a value. */
interface ConstantSeams {
  readonly checker: CheckerContext;
  /** The module whose top-level item `declaration` is; undefined for a local variable. */
  readonly moduleOfItem: (declaration: VariableDeclaration) => ModuleId | undefined;
  /**
   * Checks `declaration` in `module` as a value of its own, its initializer against `declared`,
   * then its targets, which take the value apart as a local declaration's do.
   */
  readonly checkConstant: (
    module: ModuleId,
    declaration: VariableDeclaration,
    declared: Type | undefined,
  ) => CheckedBody;
}

/** What a constant that has no value checks to: the error type, already reported. */
const uncomputed: CheckedConstant = { type: errorType, form: undefined };

/** A top-level declaration checked: its whole value, and what each of its names binds. */
interface CheckedDeclaration {
  readonly whole: CheckedConstant;
  readonly bindings: readonly TargetBinding[];
}

const unchecked: CheckedDeclaration = { whole: uncomputed, bindings: [] };

/** Whether two checks of a declaration give the same constant, and bind its names alike. */
function sameDeclaration(first: CheckedDeclaration, second: CheckedDeclaration): boolean {
  const [one, other] = [first.whole, second.whole];
  const sameWhole =
    sameTypeSpelled(one.type, other.type) &&
    (one.form === other.form ||
      (one.form !== undefined && other.form !== undefined && sameForm(one.form, other.form)));
  return sameWhole && sameBindings(first.bindings, second.bindings);
}

const sameBindings = sameItems<TargetBinding>(
  (first, second) =>
    first.name === second.name &&
    sameTypeSpelled(first.type, second.type) &&
    sameItems()(first.path, second.path),
);

export class ConstantChecks {
  readonly #seams: ConstantSeams;
  readonly #checks: EntryTable<CheckerNote, VariableDeclaration, CheckedDeclaration, ModuleId>;
  /**
   * Each initializer's checking, kept apart so that a constant's cycle keeps it, and so that a
   * constant whose value checks alike again cuts off there.
   */
  readonly #bodies: EntryTable<CheckerNote, VariableDeclaration, CheckedBody, ModuleId>;

  constructor(seams: ConstantSeams) {
    this.#seams = seams;
    this.#checks = seams.checker.entries.table({
      name: 'constants',
      compute: (declaration, module) => this.#check(module, declaration),
      equal: sameDeclaration,
      cyclic: {
        standIn: () => unchecked,
        reportMember: (member) => {
          const [name] = member.targets.flatMap(targetNames);
          const module = seams.moduleOfItem(member);
          if (name !== undefined && module !== undefined) {
            seams.checker.report(module, checkerDiagnostics.constantCycle(name.span, name.text));
          }
        },
      },
    });
    this.#bodies = seams.checker.entries.table({
      name: 'constant bodies',
      compute: (declaration, module) => {
        const { checker } = this.#seams;
        const declared =
          declaration.type === undefined
            ? undefined
            : checker.resolveType(module, declaration.type);
        return this.#seams.checkConstant(module, declaration, declared);
      },
    });
  }

  /**
   * The whole value `declaration` checks to, before its targets take it apart; undefined when it
   * isn't a top-level constant.
   */
  constantOf(declaration: VariableDeclaration): CheckedConstant | undefined {
    return this.#checked(declaration)?.whole;
  }

  /**
   * The checking of `declaration`'s initializer, which holds its lambdas (§6.4). It is reached
   * through the constant, so a cycle through it always reaches the constant first.
   */
  bodyOf(declaration: VariableDeclaration): CheckedBody | undefined {
    const module = this.#seams.moduleOfItem(declaration);
    if (module === undefined) {
      return undefined;
    }
    this.#checked(declaration);
    return this.#bodies.get(declaration, module);
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
    if (binding === undefined || binding.type.kind === 'error') {
      return uncomputed;
    }
    return {
      type: binding.type,
      form:
        form === undefined
          ? undefined
          : formAt(form, binding.path, (type) => this.#seams.checker.fieldsOf(type)),
    };
  }

  #checked(declaration: VariableDeclaration): CheckedDeclaration | undefined {
    const module = this.#seams.moduleOfItem(declaration);
    if (module === undefined) {
      return undefined;
    }
    return this.#checks.get(declaration, module);
  }

  #check(module: ModuleId, declaration: VariableDeclaration): CheckedDeclaration {
    const { checker } = this.#seams;
    const checked = this.#bodies.get(declaration, module);
    const outcome = computeConstant(declaration.initializer, {
      checker,
      constant: declaration,
      checked,
      valueNamed: (name) => this.constantNamed(module, name),
    });
    if (outcome.kind === 'refused') {
      checker.report(module, refusalOf(outcome, checkerDiagnostics.notConstant));
    }
    const form = outcome.kind === 'computed' ? outcome.form : undefined;
    return {
      whole: { type: checked.result, form },
      bindings: checked.targetsOf(declaration),
    };
  }
}
