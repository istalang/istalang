/**
 * What a struct pattern takes of a struct whose fields aren't known yet, and its rest
 * (§3.11, §3.15).
 *
 * - A struct whose fields aren't known yet, a type parameter with a struct constraint or a computed
 *   struct over one (§3.5), gives a pattern the fields its constraints name, each typed as they
 *   say, and reached by its name, as every struct's field is (`StructStep`). Any other field is
 *   unknown to the pattern, as to a field read.
 * - A rest is the mapped struct type of the keys the pattern leaves, each to its field's type:
 *   `{ [F in keyof S except "title"]: S[F] }`. Built through the program's type rules, it is the
 *   shape of those fields for a struct whose fields are known, and opaque until an instantiation
 *   makes them known otherwise, so field loops, comprehensions and keys take it as any other.
 */

import type { Identifier } from '../../../syntax/node.ts';
import type { RestPattern } from '../../../syntax/patterns.ts';
import type { FieldTarget } from '../../../syntax/statements/targets.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { PartBinding } from '../../surface/checked-pattern.ts';
import type { Type, TypeParameterType } from '../../types/type/index.ts';
import type { TypeRules } from '../../types/type-rules.ts';
import { typeText } from '../../types/type-text.ts';
import { literalType } from '../../types/unions/unions.ts';
import { anyShape, type Shape } from '../exhaustiveness/exhaustiveness.ts';
import { type PatternScope, structFieldStep, type ValuePart } from '../parts.ts';
import type { Taking } from '../taking.ts';

/**
 * Whether a pattern takes `type` apart by its fields' names: a struct whose fields aren't known.
 */
export function isStructNotKnown(scope: PatternScope, type: Type): boolean {
  return (
    type.kind !== 'error' &&
    scope.fieldsOf(type) === undefined &&
    scope.typeRules.keysOf(type, []).kind !== 'error'
  );
}

/**
 * Takes the fields `items` name of `part`, a struct whose fields aren't known yet, each by its name
 * (a pattern's items always name theirs); an item naming a field its constraints don't is reported.
 * Matches whatever its items do: anything when they all do, else it guards, as no shape can list
 * fields it doesn't know; a field two items take guards, as for a known struct (../taking.ts).
 */
export function takeFieldsByName<Target>(
  taking: Taking<Target>,
  items: readonly (FieldTarget<Target> & { readonly name: Identifier })[],
  part: ValuePart,
): Shape | undefined {
  const names = new Set<string>();
  let takenTwice = false;
  const shapes = items.map(({ name, target }) => {
    takenTwice ||= names.has(name.text);
    names.add(name.text);
    const type = fieldTypeNamed(taking.scope, part, name);
    return taking.take(target, { type, path: [...part.path, structFieldStep(part, name.text)] });
  });
  return !takenTwice && shapes.every((shape) => shape === anyShape) ? anyShape : undefined;
}

/** The type of the field `name` names in `part`'s struct; reported and the error type when none. */
function fieldTypeNamed(scope: PatternScope, part: ValuePart, name: Identifier): Type {
  const type = scope.typeRules.fieldType(part.type, literalType(name.text));
  if (type.kind === 'error') {
    scope.report(checkerDiagnostics.unknownField(name.span, typeText(part.type), name.text));
  } else {
    scope.recordField(name, { name: name.text, type });
  }
  return type;
}

/**
 * What `rest` binds of `part`, a struct of which the pattern names the fields `named`: the struct
 * of the others (`restType`), built anew from them by name. `..._` binds nothing.
 */
export function restBinding(
  rules: TypeRules,
  rest: RestPattern,
  named: readonly string[],
  part: ValuePart,
): PartBinding | undefined {
  if (rest.target.kind !== 'Identifier') {
    return undefined;
  }
  const type = restType(rules, part.type, named, rest);
  const path = [...part.path, { kind: 'fieldRest', from: part.type, to: type } as const];
  return { name: rest.target, type, path };
}

/**
 * The struct of the fields of `of` but those `named` names, written at `rest`: the mapped type of
 * its keys left, each to its field's type (§3.11); the error type when `of` is no struct, which
 * was reported where the pattern took it apart.
 */
function restType(rules: TypeRules, of: Type, named: readonly string[], rest: RestPattern): Type {
  const keys = rules.keysOf(of, named);
  if (keys.kind === 'error') {
    return keys;
  }
  const key: TypeParameterType = { kind: 'parameter', declaration: rest, within: keys };
  const value = rules.fieldType(of, key);
  return rules.mappedType({ origin: rest, named: [], parameter: rest, keys, value });
}
