/**
 * Top-level constants (§3): values computable at compile time, which a Definition stores as
 * constants rather than code. ProgramChecker composes this unit and answers `constantOf` through
 * it.
 *
 * - A constant's initializer is checked like any expression, as a value of its own: its type is the
 *   annotation, which the initializer must fit, or else the initializer's own.
 * - What compile time computes is an allow-list, and anything not on it is refused: literals, a
 *   negated number among them, duration literals, structs given every field by name, and other
 *   top-level constants. Those are exactly what lowering computes (lowering/constants.ts), so a
 *   form becomes computable in both places at once. Arrays and maps are reported as not supported
 *   yet as constants, even once their literals are.
 * - A constant is checked once, on first demand, and one defined through itself, directly or
 *   through others, is reported at every constant of the cycle (lazy-checks.ts).
 */

import type { ModuleId } from '../../program/program.ts';
import type { Expression, StructLiteral } from '../../syntax/expressions.ts';
import type { Identifier, NodeOf } from '../../syntax/node.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import type { CheckedBody, CheckedConstant } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { LazyChecks } from '../lazy-checks.ts';
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
      return { ...uncomputed, module };
    }
    return this.#checks.resultOf(declaration, () => ({
      ...this.#check(module, declaration),
      module,
    }));
  }

  #check(module: ModuleId, declaration: VariableDeclaration): CheckedBody {
    const { checker } = this.#seams;
    const [target, ...more] = declaration.targets;
    if (target === undefined || more.length > 0) {
      checker.unsupported(module, declaration, 'Destructuring');
      return uncomputed;
    }
    const declared =
      declaration.type === undefined ? undefined : checker.resolveType(module, declaration.type);
    const checked = this.#seams.checkValue(module, declaration.initializer, declared);
    const refused = refusedPart(declaration.initializer, (name) => {
      const entity = checker.bindings.entityOf(module, name);
      return (
        entity?.kind === 'variable' &&
        entity.owner.kind === 'VariableDeclaration' &&
        this.constantOf(entity.owner) !== undefined
      );
    });
    if (refused?.notYet !== undefined) {
      checker.unsupported(module, refused.part, refused.notYet);
    } else if (refused !== undefined) {
      checker.report(module, checkerDiagnostics.notConstant(refused.part.span));
    }
    return checked;
  }
}

/** What a constant that has no value checks to: the error type, already reported. */
const uncomputed: CheckedBody = {
  typeOf: () => errorType,
  callOf: () => undefined,
  result: errorType,
};

/** A part of an initializer compile time doesn't compute, and the construct, when it is one not supported yet. */
interface RefusedPart {
  readonly part: NodeOf<string>;
  readonly notYet?: string;
}

/** The first part of `node` that compile time doesn't compute; undefined when all of it does. */
function refusedPart(
  node: Expression,
  isConstant: (name: Identifier) => boolean,
): RefusedPart | undefined {
  switch (node.kind) {
    case 'IntegerLiteral':
    case 'FloatLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
    case 'DurationLiteral':
    case 'Missing':
    case 'Invalid':
      return undefined;
    case 'Parenthesized':
      return refusedPart(node.expression, isConstant);
    case 'Unary':
      return node.operator === '-' && isNumberLiteral(node.operand) ? undefined : { part: node };
    case 'Identifier':
      return isConstant(node) ? undefined : { part: node };
    case 'StructLiteral':
      for (const item of node.items) {
        const refused = refusedItem(item, isConstant);
        if (refused !== undefined) {
          return refused;
        }
      }
      return undefined;
    case 'ArrayLiteral':
    case 'MapLiteral':
      return { part: node, notYet: 'An array or map constant' };
    default:
      return { part: node };
  }
}

/** A struct literal's item: computed only when it gives a field by name; the parser reported an invalid one. */
function refusedItem(
  item: StructLiteral['items'][number],
  isConstant: (name: Identifier) => boolean,
): RefusedPart | undefined {
  if (item.kind === 'Invalid') {
    return undefined;
  }
  return item.kind === 'FieldInitializer' && item.value !== undefined
    ? refusedPart(item.value, isConstant)
    : { part: item };
}

function isNumberLiteral(node: Expression): boolean {
  if (node.kind === 'Parenthesized') {
    return isNumberLiteral(node.expression);
  }
  return node.kind === 'IntegerLiteral' || node.kind === 'FloatLiteral';
}
