/**
 * The instantiation of a trait a type meets where an `any` type's constraint asks for another
 * (§8.3), as the program's one search finds it
 * (resolution/conformance/met-instantiations/index.ts), kept per type and constraint, so fitting,
 * dispatch and the reports of a misfit read one answer.
 */

import type { Constraint, Type } from '../type/index.ts';

/**
 * The instantiation of a constraint's trait a type meets in its place: one, none, or several that
 * fit, none closer than the others.
 */
export type MetInstantiation =
  | { readonly kind: 'met'; readonly constraint: Constraint }
  | { readonly kind: 'none' }
  | { readonly kind: 'several'; readonly fitting: readonly Constraint[] };

/**
 * An instantiation of a trait a type may meet, and the type that meets it so: the type itself, or
 * the instantiation of it a witness is declared for (`Box<Scope>` for `fn draw(self: Box<Scope>,
 * s: Scope)`), which a type holding variables must then be.
 */
export interface ProposedInstantiation {
  readonly self: Type;
  readonly constraint: Constraint;
}
