/**
 * A name that refers (§3.11): a variant, tested whatever its fields hold, and warned of where it has
 * any but `Unit` ones at the part's type arguments, which `V(...)` says it leaves; a type, a struct
 * without fields among them, which matches every value of the part's own type with no test, as `_`
 * does (types/written/pattern-types.ts); or a top-level constant (named qualified, since a bare
 * camelCase name binds), compared with `==` and acting as a guard for exhaustiveness.
 */

import type { Entity } from '../../../../../binder/entities.ts';
import type { NamePattern } from '../../../../../syntax/patterns.ts';
import { lastName } from '../../../../../syntax/tree/node.ts';
import type { BodyContext } from '../../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../../diagnostics/index.ts';
import type { PatternTest } from '../../../../surface/checked-pattern.ts';
import { sameType } from '../../../../types/identity/identity.ts';
import { unitType } from '../../../../types/type/primitives.ts';
import { typeText } from '../../../../types/type/type-text.ts';
import { comparable } from '../../../../types/unions/equality.ts';
import { namesOwnType, patternTypeOf } from '../../../../types/written/pattern-types.ts';
import { anyShape } from '../../exhaustiveness/exhaustiveness.ts';
import { otherTypeNamed, type ValuePart } from '../parts.ts';
import { failed, type Leaf, type VariantPart } from '../pattern-tests.ts';
import { constructed } from '../taking.ts';
import { namedVariant } from './named-variants.ts';

export function reference(context: BodyContext, node: NamePattern, part: ValuePart): Leaf {
  const name = lastName(node.path);
  const entity = context.entityOf(name);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    const chosen = namedVariant(context, node, entity, part);
    if (chosen !== undefined && !holdsNothing(chosen)) {
      context.report(checkerDiagnostics.bareVariantPattern(node.span, name.text));
    }
    return chosen === undefined ? failed : variantLeaf(chosen);
  }
  if (entity !== undefined && patternTypeOf(context.checker, entity).kind !== 'none') {
    return typeLeaf(context, node, entity, part);
  }
  const constant = context.checker.constantNamed(context.module, name);
  if (constant === undefined) {
    if (entity !== undefined) {
      context.report(checkerDiagnostics.notPatternName(node.span, name.text));
    }
    return failed;
  }
  if (!comparable(constant.type, part.type)) {
    context.report(
      checkerDiagnostics.typeMismatch(node.span, typeText(part.type), typeText(constant.type)),
    );
  }
  const test: PatternTest = {
    kind: 'equal',
    path: part.path,
    value: { kind: 'constant', name },
    negated: false,
  };
  return { tests: [test], shape: undefined };
}

/**
 * A type pattern, the type `entity` named at `node`: it matches every value of its part, which
 * must be of that type, so nothing is tested and it covers the type (§3.11). A generic type takes
 * its type arguments from the part; a generic alias stands for no one type, so it names none.
 */
function typeLeaf(context: BodyContext, node: NamePattern, entity: Entity, part: ValuePart): Leaf {
  if (part.type.kind === 'error') {
    return failed;
  }
  if (namesOwnType(context.checker, entity, part.type)) {
    return { tests: [], shape: anyShape };
  }
  const named = { span: node.span, name: lastName(node.path) };
  context.report(otherTypeNamed(context.checker, entity, named, part.type));
  return failed;
}

/**
 * Whether `variant` holds nothing to take apart at the part's type arguments: no field, or only
 * `Unit` ones, as `Ok` of a `Result<Unit>`, so its name alone matches it fully.
 */
function holdsNothing(variant: VariantPart): boolean {
  return variant.fields.every((field) => sameType(field.type, unitType));
}

/** A variant named alone: its test, and whatever its fields hold. */
function variantLeaf({ test, key, fields }: VariantPart): Leaf {
  return {
    tests: [test],
    shape: constructed(
      key,
      fields.map(() => anyShape),
    ),
  };
}
