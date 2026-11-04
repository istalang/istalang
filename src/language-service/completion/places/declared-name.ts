/**
 * What a `declaredName` place offers: nothing for a name being declared, which is new, save where
 * the grammar lets something else stand first.
 *
 * - A top-level function's name may first name the type a static is declared on (`fn Duration.
 *   zero()`, §3.7): a struct, an enum or a primitive; a trait's function, `Self` (§3.10).
 * - `extern` is followed by `fn`, `struct` or `sendable`, or by the constant's name; `extern
 *   sendable` by `struct` (§3.6).
 * - A method's first parameter may be the receiver, `self`: a top-level or a trait's function,
 *   never a static or a local one (§3.7).
 */

import type { Entity } from '../../../compiler/binder/entities.ts';
import type { FunctionDeclaration } from '../../../compiler/syntax/declarations.ts';
import type { SyntaxNode } from '../../../compiler/syntax/tree.ts';
import { receiverParameter } from '../../../language/well-known.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { holderIn } from '../grammar/chain.ts';
import { type Word, wordCandidates } from '../grammar/words.ts';
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
  const owns = staticOwnersIn(holder);
  return owns === undefined ? [] : visibleNames(cursor, owns);
}

/** Which entities own a static declared in `holder`; a local function is none's. */
function staticOwnersIn(holder: SyntaxNode | undefined): ((entity: Entity) => boolean) | undefined {
  if (holder?.kind === 'Module') {
    return ownsStatics;
  }
  return holder?.kind === 'TraitDeclaration' ? (entity) => entity.kind === 'self' : undefined;
}

function ownsStatics(entity: Entity): boolean {
  return (
    entity.kind === 'primitive' ||
    (entity.kind === 'type' && staticOwnerKinds.has(entity.declaration.kind))
  );
}

const staticOwnerKinds: ReadonlySet<string> = new Set([
  'StructDeclaration',
  'SharedStructDeclaration',
  'ExternStructDeclaration',
  'EnumDeclaration',
]);
