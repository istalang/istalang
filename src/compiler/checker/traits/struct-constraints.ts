/**
 * Struct constraints (§3.5): `struct { title: String; [_] is FormNode }` after `is`, resolved
 * where it is written into what it asks of a struct's fields (types/struct-constraint.ts).
 *
 * - A constraint is open: it states the fields its entries name, in name order as every struct's
 *   fields are (§3.1), and what every other field must be (`others`), or nothing.
 * - An entry's rule is exact (`title: String`, after aliases) or the constraints a field's type
 *   meets (`meta is struct { tag: String } & Sendable`). Its traits are resolved as `any` takes
 *   them, `Self` the trait's own, since each field it constrains is its own type: they are applied
 *   to a field's type where one is checked (`constraintOn`).
 * - A struct constraint is a constraint, never a type, so the parser reads one only after `is`.
 *   One `[_]` entry at most is reported here, where the constraint is resolved.
 */

import type { ModuleId } from '../../program/program.ts';
import type { TypeParameter } from '../../syntax/declarations.ts';
import { isMissingName } from '../../syntax/node.ts';
import type { ConstraintNode, FieldEntry, StructConstraint } from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { parameterType } from '../types/resolve-type.ts';
import type {
  ConstraintSet,
  EntryRule,
  StructConstraintModel,
} from '../types/struct-constraint.ts';
import { type Constraint, inFieldOrder } from '../types/type.ts';
import { type ConstraintSite, resolveConstraint } from './constraints.ts';

/** The struct constraints after `is` on `parameter`, resolved in `module`, where it is declared. */
export function resolveStructConstraints(
  checker: CheckerContext,
  module: ModuleId,
  parameter: TypeParameter,
): readonly StructConstraintModel[] {
  return parameter.constraints.flatMap((node) =>
    node.kind === 'StructConstraint' ? [resolveStructConstraint(checker, module, node)] : [],
  );
}

/**
 * The constraints `nodes` write after `is`, resolved in `module`, each trait's `Self` standing
 * for what `selfOf` says: its own by default, as `any` takes it.
 */
export function resolveConstraintSet(
  checker: CheckerContext,
  module: ModuleId,
  nodes: readonly ConstraintNode[],
  selfOf: ConstraintSite['selfOf'] = parameterType,
): ConstraintSet {
  const traits: Constraint[] = [];
  const structs: StructConstraintModel[] = [];
  for (const node of nodes) {
    if (node.kind === 'StructConstraint') {
      structs.push(resolveStructConstraint(checker, module, node));
    } else {
      const trait = resolveConstraint(checker, module, node, { keyword: 'is', selfOf });
      traits.push(...(trait === undefined ? [] : [trait]));
    }
  }
  return { traits, structs };
}

function resolveStructConstraint(
  checker: CheckerContext,
  module: ModuleId,
  node: StructConstraint,
): StructConstraintModel {
  const entries = node.entries.filter((entry) => entry.kind !== 'Invalid');
  const others = entries.filter((entry) => entry.field.kind === 'OtherFields');
  for (const extra of others.slice(1)) {
    checker.report(module, checkerDiagnostics.severalOtherFields(extra.field.span));
  }
  const named = entries.flatMap((entry) =>
    entry.field.kind === 'Identifier' && !isMissingName(entry.field)
      ? [{ name: entry.field.text, rule: entryRule(checker, module, entry) }]
      : [],
  );
  const [other] = others;
  return {
    named: inFieldOrder(named),
    others: other === undefined ? undefined : entryRule(checker, module, other),
  };
}

function entryRule(checker: CheckerContext, module: ModuleId, entry: FieldEntry): EntryRule {
  return entry.kind === 'FieldTypeEntry'
    ? { kind: 'type', type: checker.resolveType(module, entry.type) }
    : { kind: 'meets', ...resolveConstraintSet(checker, module, entry.constraints) };
}
