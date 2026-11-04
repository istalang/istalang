/**
 * What a `type` place offers: the visible names of types, with namespaces, which qualify one
 * (`time.Duration`), and the words a type starts with (`typeWords`, syntax/grammar-words.ts, which
 * the parser's type tables are keyed by). An anonymous struct type is written `{…}`, as the
 * formatter prints it, so `struct` before its brace is not offered.
 *
 * A trait is no type of its own, so a trait is offered only where one is asked for: a type
 * parameter's bound (`T is ‸`) and after `any`. After `new`, only a shared struct is built (§3.18).
 */

import { type Entity, namesType } from '../../../compiler/binder/entities.ts';
import { typeWords } from '../../../compiler/syntax/grammar-words.ts';
import type { SyntaxNode } from '../../../compiler/syntax/tree.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { holderIn } from '../grammar/chain.ts';
import { wordCandidates } from '../grammar/words.ts';
import { followsNew, type ParsedPlace } from '../placeholder.ts';
import { visibleNames } from '../visible.ts';

export function offerType(
  cursor: Cursor,
  { parsed }: Extract<ParsedPlace, { readonly kind: 'type' }>,
): readonly Candidate[] {
  if (followsNew(cursor)) {
    return namesWhere(cursor, (entity) => isDeclared(entity, 'SharedStructDeclaration'));
  }
  if (asksForTrait(parsed.chain)) {
    return namesWhere(cursor, (entity) => isDeclared(entity, 'TraitDeclaration'));
  }
  return [
    ...namesWhere(cursor, (entity) => namesType(entity) && !isDeclared(entity, 'TraitDeclaration')),
    ...wordCandidates(offeredTypeWords),
  ];
}

const offeredTypeWords = typeWords.filter((word) => word !== 'struct');

/** The visible names `keeps`, with the namespaces, which may qualify one. */
function namesWhere(cursor: Cursor, keeps: (entity: Entity) => boolean): readonly Candidate[] {
  return visibleNames(cursor, (entity) => entity.kind === 'namespace' || keeps(entity));
}

function isDeclared(entity: Entity, kind: SyntaxNode['kind']): boolean {
  return entity.kind === 'type' && entity.declaration.kind === kind;
}

/** Whether the written type is a bound or follows `any`: its node's holder, a type parameter's constraint or an `any`. */
function asksForTrait(chain: readonly SyntaxNode[]): boolean {
  const written = chain.at(-2);
  const holder = written === undefined ? undefined : holderIn(chain, written);
  if (written === undefined || holder === undefined) {
    return false;
  }
  return (
    holder.kind === 'AnyType' ||
    (holder.kind === 'TypeParameter' && holder.constraints.some((each) => each === written))
  );
}
