/**
 * Whether a type's values are disposable (§16): one a `dispose` takes as `self`, which
 * rules/disposal/disposal.ts finds and `checker.disposalOf` keeps, or a type known by its
 * constraints whose traits require a `dispose`, as `Disposable` does (§8.4). It sits with the
 * traits derived from a type's form, beneath the rules, so sendability (sendability.ts) and the
 * rules that dispose read one answer.
 */

import { disposeFunction } from '../../../../foundation/language/well-known/implicit-calls.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Type } from '../type/index.ts';
import { requiredFunctions } from './constraints.ts';
import { knownConstraints } from './known-constraints.ts';

/**
 * Whether values of `type` are disposable: a handle with a `dispose`, or a type parameter or an
 * `any` type whose constraints require one, as `Disposable` does, so every type meeting them has
 * one (§8.4).
 */
export function isDisposable(checker: CheckerContext, type: Type): boolean {
  switch (type.kind) {
    case 'nominal':
      return checker.disposalOf(type).kind !== 'none';
    case 'parameter':
    case 'associated':
    case 'field':
    case 'any':
      return knownConstraints(checker, type).some(({ trait }) =>
        requiredFunctions(trait).some(({ name }) => name.text === disposeFunction),
      );
    case 'primitive':
    case 'literal':
    case 'union':
    case 'keys':
    case 'mapped':
    case 'match':
    case 'recursive':
    case 'anonymous':
    case 'tuple':
    case 'function':
    case 'error':
      return false;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
