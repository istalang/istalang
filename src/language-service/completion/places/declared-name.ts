/**
 * What a `declaredName` place offers: nothing for a name being declared, which is new, save where
 * the grammar lets something else stand first.
 *
 * - A top-level function's name may first name the type a static is declared on (`fn Duration.
 *   zero()`, §3.7): whatever the checker's static functions may be declared on (types/written/named-types.ts),
 *   an alias of a shape among them (§3.17); a trait's function, `Self` (§3.10).
 * - `extern` is followed by `fn`, `struct` or `sendable`, or by the constant's name; `extern
 *   sendable` by `struct` (§3.6).
 * - A method's first parameter may be the receiver, `self`: a top-level or a trait's function,
 *   never a static or a local one (§3.7).
 * - A struct's, an enum's or a trait's member may be an associated type instead, `type Data = T`
 *   (§3.1, §3.10), and a trait's a function.
 */

import { entityType, staticOwnerOf } from '../../../compiler/checker/types/written/named-types.ts';
import type { FunctionDeclaration } from '../../../compiler/syntax/declarations/index.ts';
import type { Word } from '../../../compiler/syntax/grammar-words.ts';
import type { SyntaxNode } from '../../../compiler/syntax/tree.ts';
import { receiverParameter } from '../../../language/well-known/index.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { holderIn } from '../grammar/chain.ts';
import { wordCandidates } from '../grammar/words.ts';
import type { ParsedPlace } from '../placeholder.ts';
import { visibleNames } from '../visible.ts';

export function offerDeclaredName(
  cursor: Cursor,
  { parsed }: Extract<ParsedPlace, { readonly kind: 'declaredName' }>,
): readonly Candidate[] {
  const { chain } = parsed;
  const name = chain.at(-1);
  const declaring = chain.at(-2);
  const holder = declaring === undefined ? undefined : holderIn(chain, declaring);
  switch (declaring?.kind) {
    case 'FunctionDeclaration':
      return namesOwner(declaring, name) ? staticOwners(cursor, holder) : [];
    case 'ExternConstantDeclaration':
      return wordCandidates(externWords);
    case 'ExternStructDeclaration':
      return followsSendable(cursor) ? wordCandidates(['struct']) : [];
    case 'DeclaredField':
    case 'Variant':
      return declaring.name === name ? wordCandidates(['type']) : [];
    case 'FieldDeclaration':
      return declaring.name === name && holder?.kind === 'TraitDeclaration'
        ? wordCandidates(['type', 'fn'])
        : [];
    case 'Parameter':
      return holder?.kind === 'FunctionDeclaration' &&
        holder.parameters[0] === declaring &&
        !declaring.isRest &&
        mayTakeSelf(holder, holderIn(chain, holder))
        ? [receiver]
        : [];
    default:
      return [];
  }
}

/**
 * Whether `name` may name the type `declaration` is a static of: its owner, or its name while no
 * owner is written (`fn Pair. ‸` declares the static's own name).
 */
function namesOwner(declaration: FunctionDeclaration, name: SyntaxNode | undefined): boolean {
  return (
    declaration.owner === name || (declaration.owner === undefined && declaration.name === name)
  );
}

/** `extern sendable ‸`: the parser takes the name for an extern struct's, whose `struct` is to come. */
function followsSendable({ tree, before }: Cursor): boolean {
  return (
    before !== undefined &&
    tree.source.text.slice(before.span.start, before.span.end) === 'sendable'
  );
}

/** Whether `declaration`, held by `holder`, may be a method: a top-level or a trait's function, no static. */
function mayTakeSelf(declaration: FunctionDeclaration, holder: SyntaxNode | undefined): boolean {
  return (
    declaration.owner === undefined &&
    (holder?.kind === 'Module' || holder?.kind === 'TraitDeclaration')
  );
}

const externWords: readonly Word[] = ['fn', 'struct', 'sendable'];

/** A method's receiver is the parameter named `self`, a name the language gives a role, like a word. */
const receiver: Candidate = { name: receiverParameter, subject: { kind: 'keyword' } };

/** The types a function declared in `holder` may be a static of. */
function staticOwners(cursor: Cursor, holder: SyntaxNode | undefined): readonly Candidate[] {
  if (holder?.kind === 'Module') {
    return visibleNames(
      cursor,
      (entity) => staticOwnerOf(entityType(cursor.checker, entity)) !== undefined,
    );
  }
  return holder?.kind === 'TraitDeclaration'
    ? visibleNames(cursor, (entity) => entity.kind === 'self')
    : [];
}
