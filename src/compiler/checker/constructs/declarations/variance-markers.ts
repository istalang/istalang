/**
 * Where a written variance may stand (§3.5), and what it must agree with:
 *
 * - On an extern value's type parameter, it is the variance (types/variance/variance.ts).
 * - On a struct's or an enum's, it asserts the derived one, which it must match: a parameter both
 *   given and taken, or a member parameter, contradicts either word.
 * - A handle's are invariant until view handles exist (tracker F27): a value put in through one
 *   copy is read through every other.
 * - A function's, a trait's or an alias's take none: each call infers a function's, a trait's is
 *   derived where it is used through `any`, and an alias has the variance of the type it names.
 */

import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import { typeParametersOf } from '../../../syntax/declarations/index.ts';
import type { VarianceMarker } from '../../../syntax/tokens/grammar-words.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { isHandleDeclaration } from '../../types/properties/handles.ts';
import { isDerived, markerVariances } from '../../types/variance/variance.ts';
import type { GenericDeclaration } from '../../types/written/type-arguments.ts';

/** Reports each variance written on `declaration`'s type parameters where it doesn't belong. */
export function checkVarianceMarkers(
  checker: Pick<CheckerContext, 'fitting' | 'moduleOf' | 'report'>,
  declaration: GenericDeclaration,
): void {
  const parameters = typeParametersOf(declaration.typeParameters);
  parameters.forEach((parameter, index) => {
    const word = parameter.variance;
    if (word !== undefined) {
      checkMarker(checker, declaration, { parameter, index, word });
    }
  });
}

/** A variance written on one type parameter, and where it stands among them. */
interface Written {
  readonly parameter: TypeParameter;
  readonly index: number;
  readonly word: VarianceMarker;
}

function checkMarker(
  checker: Pick<CheckerContext, 'fitting' | 'moduleOf' | 'report'>,
  declaration: GenericDeclaration,
  { parameter, index, word }: Written,
): void {
  const module = checker.moduleOf(declaration);
  const { span, text } = parameter.name;
  switch (declaration.kind) {
    case 'StructDeclaration':
    case 'EnumDeclaration':
    case 'SharedStructDeclaration':
    case 'ExternStructDeclaration': {
      if (isHandleDeclaration(declaration)) {
        checker.report(module, checkerDiagnostics.varianceOnHandle(span, word, text));
        return;
      }
      const derived = checker.fitting.varianceOf(declaration)[index];
      if (isDerived(declaration) && derived !== markerVariances[word]) {
        checker.report(
          module,
          checkerDiagnostics.varianceContradicted(span, word, text, derived ?? 'invariant'),
        );
      }
      return;
    }
    default:
      checker.report(
        module,
        checkerDiagnostics.varianceNotHere(span, word, text, whyNone[declaration.kind]),
      );
  }
}

/** Why a declaration of each other kind takes no written variance. */
// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const whyNone = {
  FunctionDeclaration: 'each call infers a function’s type arguments, and nothing compares them',
  TraitDeclaration: 'a trait’s variance is derived where it is used through `any`',
  TypeAliasDeclaration: 'an alias is the type it names, whose variance it has',
} as const;
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
