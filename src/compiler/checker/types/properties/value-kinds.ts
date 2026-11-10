/**
 * A value's data kind (proposal 8, Rule 2), in one home: the kinds the parts a value holds are of,
 * read on the walk over what a value holds (held.ts), as whether it may leave its instance is
 * (traits/sendable.ts). The data rule (rules/kinds/data-kinds.ts) holds every value code handles to
 * its code's mark.
 *
 * - A future holds its kind, `live`, `ista` or a variable; a handle that stays in its process
 *   (`extern live struct`) is `live`; a value a `dispose` of a kind may take is of it, since
 *   releasing it calls that code (Rule 2's implicit calls), whatever that dispose's constraints:
 *   meeting a trait asks a type's kinds (Rule 4), so they never ask it. So a slot, whose runtime
 *   `dispose` is `ista`, is ista. Anything holding one at any depth is of its kind, whatever else it
 *   holds, a future's value among it, so one type may hold both kinds, which no code may handle.
 * - A function is simple data, whatever its mark: holding one isn't calling it (Rule 2).
 * - A type parameter's values are simple where they are handled: generic code passes them through,
 *   and the code that names their type handles them (Rule 3).
 * - A type holds what its written types do: a struct's fields', an enum's variants', an extern
 *   type's arguments. A field whose type its default gives adds no kind (§3.3: its default is
 *   judged as code of the kind its written fields give), so no default is checked to find a kind,
 *   which a body still being checked may ask (a lambda inferring its mark).
 */

import { typeParametersOf } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { sameType } from '../identity/identity.ts';
import { substitute, substitutionFor } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import { isComputed, unfolded } from '../type/computed-types.ts';
import { isSimpleMark, persistenceOf } from '../type/function-kinds.ts';
import { type NominalEntity, type NominalType, nominalType, type Type } from '../type/index.ts';
import { markType } from '../type/primitives.ts';
import { awaitedOf } from '../type/well-known.ts';
import { isConfined, staysInProcess } from './handles.ts';
import { heldPartsOf } from './held.ts';
import { TypeCycle } from './type-cycle.ts';

/**
 * What the values of a nominal type's declaration hold of kinds, its own type parameters standing
 * for its arguments, found by one walk over what they hold (held.ts), kept per declaration: the
 * kinds of the parts no argument decides, and the parts an argument does, read again for each
 * instantiation (`heldKindsOf`), so a type's kinds compose without walking its layout again.
 */
export interface DeclaredKinds {
  readonly marks: readonly Type[];
  readonly dependent: readonly Type[];
}

/** What the values of `entity`'s declaration hold of kinds (`DeclaredKinds`). */
export function declaredKindsOf(checker: CheckerContext, entity: NominalEntity): DeclaredKinds {
  const parameters = typeParametersOf(entity.declaration.typeParameters);
  const own = nominalType(
    entity,
    parameters.map((declaration): Type => ({ kind: 'parameter', declaration })),
  );
  const parts = writtenTypesOf(checker, own);
  const decided = (part: Type) =>
    parametersIn(part).some((parameter) => parameters.some((each) => each === parameter));
  // Only a part that may add a kind once instantiated is read again per instantiation, once.
  const adds = (part: Type) =>
    part.kind === 'parameter' || isComputed(part) || mayOwnKind(checker, part);
  return {
    marks: distinctKinds(
      parts.flatMap((part) => (decided(part) ? [] : ownValueKindsOf(checker, part))),
    ),
    dependent: parts
      .filter((part) => decided(part) && adds(part))
      .filter((part, index, all) => all.findIndex((each) => sameType(each, part)) === index),
  };
}

/**
 * The distinct kinds the parts a value of `type` holds are of, outermost first; none where no part
 * has one. A nominal type's are its declaration's (`declaredOf`), with those of each part its
 * arguments decide, instantiated: an argument's own, a type its arguments compute walked whole,
 * any other part's own kind, its own parts being parts of the declaration's too.
 */
export function heldKindsOf(checker: CheckerContext, type: Type, kept: KeptKinds): readonly Type[] {
  if (holdsNoKind(type)) {
    return [];
  }
  if (type.kind === 'recursive') {
    return kept.walkedOf(type);
  }
  if (type.kind !== 'nominal') {
    return distinctKinds(
      writtenPartsOf(checker, type).flatMap((part) => partKindsOf(checker, kept, part)),
    );
  }
  const declared = kept.declaredOf(type.entity);
  const substitution = substitutionFor(
    typeParametersOf(type.entity.declaration.typeParameters),
    type.arguments,
  );
  return distinctKinds([
    ...declared.marks,
    ...declared.dependent.flatMap((part) =>
      instantiatedKindsOf(checker, kept, part, substitute(part, substitution, checker.typeRules)),
    ),
  ]);
}

/** The kinds `instantiated`, a part of a declaration its arguments decide (`part`), adds. */
function instantiatedKindsOf(
  checker: CheckerContext,
  kept: KeptKinds,
  part: Type,
  instantiated: Type,
): readonly Type[] {
  if (part.kind === 'parameter') {
    return partKindsOf(checker, kept, instantiated);
  }
  if (isComputed(part)) {
    return kept.walkedOf(instantiated);
  }
  return ownValueKindsOf(checker, instantiated);
}

/**
 * The kinds of `part`, a part of a type whose kinds are composed: a recursive type's walked whole,
 * since its unfolding, whose key is its own, holds it again; any other's composed in turn.
 */
function partKindsOf(checker: CheckerContext, kept: KeptKinds, part: Type): readonly Type[] {
  return part.kind === 'recursive' ? kept.walkedOf(part) : checker.valueKindsOf(part);
}

/**
 * What composing a type's kinds reads of the checker's entries: each declaration's kinds, and the
 * kinds of a type walked whole (`walkedKindsOf`), each kept per declaration or type.
 */
export interface KeptKinds {
  readonly declaredOf: (entity: NominalEntity) => DeclaredKinds;
  readonly walkedOf: (type: Type) => readonly Type[];
}

/**
 * The kinds of `type` found by walking what it holds whole: for a recursive type, whose key is that
 * of its unfolding, which its parts hold again, and for a type a declaration's arguments compute,
 * which may be any type; it asks no kinds of the checker's entries, so none is asked again while it
 * computes. Where a type recurs it holds nothing more (held.ts).
 */
export function walkedKindsOf(checker: CheckerContext, type: Type): readonly Type[] {
  return distinctKinds(
    writtenTypesOf(checker, type).flatMap((part) => ownValueKindsOf(checker, part)),
  );
}

/**
 * How often one declaration's type may stand inside itself on a walk's path: a recursion whose
 * arguments only permute repeats a type well before, and one whose arguments grow without end needs
 * endlessly many instantiations, refused where it is declared (rules/expansion/).
 */
const nestingBound = 8;

/**
 * Every type `type` holds by its written types (`writtenPartsOf`), itself first, once along each
 * path: written types skip the layout, which stops an expansion, so the walk bounds one itself.
 */
function writtenTypesOf(checker: CheckerContext, type: Type): readonly Type[] {
  const held: Type[] = [];
  const cycle = new TypeCycle(checker.typeKeys);
  const nesting = new Map<object, number>();
  const walk = (part: Type): void => {
    held.push(part);
    // Only a nominal or recursive type can stand inside itself, so only those are guarded, by key.
    if (part.kind !== 'nominal' && part.kind !== 'recursive') {
      writtenPartsOf(checker, part).forEach(walk);
      return;
    }
    const declaration = part.kind === 'nominal' ? part.entity.declaration : undefined;
    const depth = declaration === undefined ? 0 : (nesting.get(declaration) ?? 0);
    if (depth >= nestingBound) {
      return;
    }
    if (declaration !== undefined) {
      nesting.set(declaration, depth + 1);
    }
    cycle.enter(part, undefined, () => writtenPartsOf(checker, part).forEach(walk));
    if (declaration !== undefined) {
      nesting.set(declaration, depth);
    }
  };
  walk(type);
  return held;
}

/**
 * What a value of `type` holds one level down by the types written for it: a struct's fields' and
 * an enum's variants' written types, as the type's arguments instantiate them, an extern type's
 * arguments, and a tuple's, a union's or a shape's parts (held.ts).
 */
function writtenPartsOf(checker: CheckerContext, type: Type): readonly Type[] {
  if (type.kind === 'recursive') {
    return writtenPartsOf(checker, unfolded(type));
  }
  if (type.kind !== 'nominal') {
    return heldPartsOf(checker, type);
  }
  const { declaration } = type.entity;
  if (declaration.kind === 'ExternStructDeclaration') {
    return type.arguments;
  }
  const fields =
    declaration.kind === 'EnumDeclaration'
      ? declaration.variants.flatMap((variant) =>
          variant.kind === 'Variant' ? variant.fields : [],
        )
      : declaration.fields;
  const module = checker.moduleOf(declaration);
  const substitution = substitutionFor(
    typeParametersOf(declaration.typeParameters),
    type.arguments,
  );
  return fields.flatMap((field) =>
    field.kind === 'DeclaredField' && field.type !== undefined
      ? [substitute(checker.resolveType(module, field.type), substitution, checker.typeRules)]
      : [],
  );
}

/** `kinds` but simple ones, each once. */
function distinctKinds(kinds: readonly Type[]): readonly Type[] {
  return kinds
    .filter((kind) => !isSimpleMark(kind))
    .filter((kind, index, all) => all.findIndex((each) => sameType(each, kind)) === index);
}

/**
 * Whether a value of `part` may be of a kind by what it is, whatever its arguments: a handle that
 * stays in its process, a future, or a value with an identity of its own, which may be disposable.
 */
function mayOwnKind(checker: CheckerContext, part: Type): part is NominalType {
  if (part.kind !== 'nominal') {
    return false;
  }
  const { declaration } = part.entity;
  return (
    staysInProcess(declaration) || isConfined(declaration) || awaitedOf(checker, part) !== undefined
  );
}

/** The kinds a value of `part` is of itself, by what it is, not what it holds. */
function ownValueKindsOf(checker: CheckerContext, part: Type): readonly Type[] {
  if (!mayOwnKind(checker, part)) {
    return [];
  }
  if (staysInProcess(part.entity.declaration)) {
    return [markType('live')];
  }
  const awaited = awaitedOf(checker, part)?.mode;
  if (awaited !== undefined) {
    // A future of no mark, `Future<Int, Int>`, is refused where it is written; it holds no kind.
    return persistenceOf(awaited) !== undefined || awaited.kind === 'parameter' ? [awaited] : [];
  }
  // Only a value with an identity of its own is disposable (rules/disposal/disposal.ts).
  return isConfined(part.entity.declaration) ? checker.disposeKindsOf(part) : [];
}

/**
 * Whether no value of `type` holds anything of a kind, by its form alone: a primitive, a literal, a
 * function (simple data, proposal 8, Rule 2) or a type parameter's value (passed through, Rule 3).
 * Most values a body computes are, so their kinds need no key.
 */
export function holdsNoKind(type: Type): boolean {
  switch (type.kind) {
    case 'primitive':
    case 'literal':
    case 'function':
    case 'parameter':
    case 'error':
      return true;
    default:
      return false;
  }
}
