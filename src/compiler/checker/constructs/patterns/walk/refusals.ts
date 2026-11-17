/**
 * What a pattern refused where it stands binds (§3.11, §3.15): a call pattern naming no variant,
 * braces after a variant's name, a construct that could fail to match standing in a target. Each
 * is reported once, and its names bound at the error type (`bindAt`), so their uses resolve with
 * nothing more to report.
 */

import type { Pattern, PatternPart } from '../../../../syntax/patterns.ts';
import { targetNames } from '../../../../syntax/patterns.ts';
import { lastName } from '../../../../syntax/tree/node.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import type { PartBinding } from '../../../surface/checked-pattern.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { namesOwnType } from '../../../types/written/pattern-types.ts';
import { anyShape, type Shape } from '../exhaustiveness/exhaustiveness.ts';
import type { ItemTaking } from './kinds/arrays.ts';
import { calledVariant, takeVariantBraces, variantBraced } from './kinds/variant-calls.ts';
import type { ValuePart } from './parts.ts';

/** What refusing needs of a pattern's walk (index.ts): whether it may fail, and the names bound. */
export interface Refusing extends ItemTaking {
  /** Whether the pattern may fail to match: a case's or an `is`'s, never a target's. */
  readonly refutable: boolean;
  readonly bindings: PartBinding[];
}

/** A refused pattern as walked: its shape for exhaustiveness, at the part it stands at. */
interface Refused {
  readonly shape: Shape | undefined;
  readonly part: ValuePart;
}

/**
 * `node`, a call pattern naming no variant, reported (`calledVariant`); undefined for any other
 * pattern. Its arguments are each taken over the error type, so their names bind and what they
 * compare with is checked, in a target only bound, which must always match. Naming its value's own
 * type, it meant the value whole, so it covers it and nothing more is reported of its `match`;
 * naming any other, it covers nothing.
 */
export function refusedCall(
  walk: Refusing,
  node: Pattern | PatternPart,
  part: ValuePart,
): Refused | undefined {
  if (node.kind !== 'VariantCallPattern' || calledVariant(walk.context, node) !== undefined) {
    return undefined;
  }
  if (walk.refutable) {
    for (const argument of node.arguments) {
      walk.take(argument, { type: errorType, path: part.path });
    }
  } else {
    bindAt(walk, node, part, errorType);
  }
  const entity = walk.context.entityOf(lastName(node.callee.path));
  const covers = entity !== undefined && namesOwnType(walk.context.checker, entity, part.type);
  return { shape: covers ? anyShape : undefined, part };
}

/**
 * `node`, braces after a variant's name, reported (§3.11), nothing selected of its part first;
 * undefined for any other pattern. A target's binds at the error type (kinds/variant-calls.ts).
 */
export function refusedBraces(
  walk: Refusing,
  node: Pattern | PatternPart,
  part: ValuePart,
): Refused | undefined {
  const braced = variantBraced(walk.context, node);
  if (braced === undefined) {
    return undefined;
  }
  walk.context.report(checkerDiagnostics.variantInBracesPattern(node.span, braced.name));
  if (!walk.refutable) {
    bindAt(walk, node, part, errorType);
    return { shape: anyShape, part };
  }
  return { shape: takeVariantBraces(walk, braced, part), part };
}

/**
 * A construct that could fail to match, standing in a target, which must always match: reported
 * once, its names bound at the error type (`bindAt`). Nothing inside it is taken apart, so a
 * target's parts are fields and tuple elements only.
 */
export function refused(walk: Refusing, node: Pattern | PatternPart, part: ValuePart): Shape {
  walk.context.report(checkerDiagnostics.refutableTarget(node.span));
  bindAt(walk, node, part, errorType);
  return anyShape;
}

/**
 * Binds each name `node` binds at `type`, the error type or `Never`, to the part it stands at: what
 * a pattern that isn't taken apart, refused where it stands, naming nothing or never running,
 * binds, so each use of its names resolves with nothing more to report, and an or-pattern's
 * alternatives still agree on them. In a case, a bare name the binder didn't make a variable refers
 * to something, so it binds nothing.
 */
export function bindAt(
  walk: Refusing,
  node: Pattern | PatternPart,
  part: ValuePart,
  type: Type,
): void {
  const names = new Set(
    targetNames(node).flatMap((name) => {
      const entity = walk.context.entityOf(name);
      if (entity?.kind === 'variable') {
        return [entity.name];
      }
      return walk.refutable ? [] : [name];
    }),
  );
  for (const name of names) {
    walk.bindings.push({ name, type, path: part.path });
  }
}
