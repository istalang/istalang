/**
 * Top-level constants (§3): computed while compiling, into the value a Definition stores among its
 * constants, so reading one is a `constant` instruction like any literal's.
 *
 * The checker held the initializer to what compile time computes (checker/declarations/
 * constants.ts); this module follows its decisions. A struct is laid out as a struct literal is at
 * run time (expressions/structs.ts), and a duration literal is its `time.Duration` struct (§2).
 * Another constant is computed again where it is named: interning the result (tables.ts) keeps one
 * copy, and the checker refused cycles.
 */

import type { Value } from '../../definition/values.ts';
import type { CheckedConstant, Checker } from '../checker/check.ts';
import type { ModuleId } from '../program/program.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Identifier } from '../syntax/node.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
import { inDeclarationOrder, nominalTypeOf } from './expressions/structs.ts';
import type { DefinitionTables } from './tables.ts';

/** A top-level constant a name denotes: its declaration, and the checking of its initializer. */
export interface NamedConstant {
  readonly declaration: VariableDeclaration;
  readonly checked: CheckedConstant;
}

/** The top-level constant `name` denotes in `module`; undefined when it denotes anything else. */
export function constantNamed(
  checker: Checker,
  module: ModuleId,
  name: Identifier,
): NamedConstant | undefined {
  const entity = checker.bindings.entityOf(module, name);
  const owner = entity?.kind === 'variable' ? entity.owner : undefined;
  const checked = owner?.kind === 'VariableDeclaration' ? checker.constantOf(owner) : undefined;
  return owner?.kind === 'VariableDeclaration' && checked !== undefined
    ? { declaration: owner, checked }
    : undefined;
}

/** The value of a top-level constant, computed from its checked initializer. */
export function constantValue(
  checker: Checker,
  tables: DefinitionTables,
  { declaration, checked }: NamedConstant,
): Value {
  const structValue = (node: Expression, fields: Value[]): Value => ({
    kind: 'struct',
    type: tables.typeIndex(nominalTypeOf(checked, node)),
    fields,
  });
  const evaluate = (node: Expression): Value => {
    switch (node.kind) {
      case 'IntegerLiteral':
      case 'FloatLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        return node.value;
      case 'Parenthesized':
        return evaluate(node.expression);
      case 'Unary':
        return negated(evaluate(node.operand));
      case 'DurationLiteral':
        return structValue(node, [node.value]);
      case 'StructLiteral': {
        const given = new Map(
          node.items.flatMap((item) =>
            item.kind === 'FieldInitializer' && item.value !== undefined
              ? [[item.name.text, evaluate(item.value)] as const]
              : [],
          ),
        );
        return structValue(node, inDeclarationOrder(checker, nominalTypeOf(checked, node), given));
      }
      case 'Identifier': {
        const named = constantNamed(checker, checked.module, node);
        if (named === undefined) {
          throw new Error(`'${node.text}' is no constant; the checker should have said so.`);
        }
        return constantValue(checker, tables, named);
      }
      default:
        throw new Error(
          `A ${node.kind} isn't computable at compile time; the checker should have said so.`,
        );
    }
  };
  return evaluate(declaration.initializer);
}

function negated(value: Value): Value {
  if (typeof value === 'bigint' || typeof value === 'number') {
    return -value;
  }
  throw new TypeError('Only a number is negated at compile time; the checker should have said so.');
}
