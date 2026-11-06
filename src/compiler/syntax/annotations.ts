/**
 * Annotations (§3.16) and the items that carry them.
 *
 * An annotation is a struct value after `@`. The parser keeps it as an expression of a restricted
 * shape (a name or a struct literal). Whether that names an annotation struct, and whether the
 * annotation means anything where it stands, is the checker's call.
 *
 * An item's annotations are one list in source order, whether written above it (`@Suite{…}` over a
 * function) or after it on its line (`userId: Int @JsonName{"user_id"}`): which side each stands on
 * is in its span, and traversal orders children by span (tree/index.ts). The field is absent when
 * there are none, which keeps every unannotated item free of annotation noise.
 */

import type { Expression } from './expressions/index.ts';
import type { NodeOf } from './tree/node.ts';

export interface Annotation extends NodeOf<'Annotation'> {
  readonly value: Expression;
}

/** What every declaration, statement, field and enum variant may carry. */
export interface Annotatable {
  readonly annotations?: readonly Annotation[];
}
