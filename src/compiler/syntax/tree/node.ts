/**
 * What every syntax tree node shares, and the nodes that every grammar category uses.
 *
 * A node is an immutable plain object: a `kind` naming its shape, a `span` anchored to its segment
 * of text (positions.ts), and fields that are nodes, arrays of nodes, optional nodes or node
 * arrays, records of words (a function's qualifiers, ../tokens/modifiers.ts), or primitives. That invariant is what lets traversal be derived from the fields
 * (index.ts) instead of being written out for each kind. Nodes hold no tokens and no resolved
 * references; later phases keep those in side tables keyed by node.
 *
 * Errors are part of the tree, so every phase always gets a complete one:
 * - `Missing` stands where the grammar required something that isn't there. Its span is empty.
 * - `Invalid` covers tokens the parser skipped to recover. It sits in the list where they appeared.
 *   Annotations nothing can take (§5.5) stay in the one covering them, so their values are still
 *   bound and checked, as an editor completes inside one before its item is written.
 * - A required name that is absent is an Identifier with empty text, so name fields never need a
 *   union check.
 * The parser reports a diagnostic for each of them.
 */

import type { Annotatable } from '../items.ts';
import type { AnchoredSpan } from './positions.ts';

export interface NodeOf<Kind extends string> {
  readonly kind: Kind;
  readonly span: AnchoredSpan;
}

/** A name. Empty `text` marks a name the parser expected but didn't find. */
export interface Identifier extends NodeOf<'Identifier'> {
  readonly text: string;
}

/** A possibly qualified name, `Pair` or `time.Duration`. It always has at least one part. */
export type QualifiedName = readonly [Identifier, ...Identifier[]];

/** The last part of a qualified name: what it names, after the modules and types qualifying it. */
export function lastName(path: QualifiedName): Identifier {
  return path.at(-1) ?? path[0];
}

/** Whether the parser expected a name here and found none: such a name has empty text. */
export function isMissingName(name: Identifier): boolean {
  return name.text === '';
}

export type Missing = NodeOf<'Missing'>;

export interface Invalid extends NodeOf<'Invalid'>, Annotatable {}
