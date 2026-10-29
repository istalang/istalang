/**
 * What tools ask of a checked program by position: what an identifier denotes, the checked body
 * holding a node, the type a written type denotes, and the members a type has. A model check.ts
 * names; lookup/ answers it.
 *
 * - Every identifier is answered alike, wherever it stands: in a body, a signature, a type, an
 *   import or a declaring name. One query serves going to a definition, finding references,
 *   renaming and hovering, so they never disagree about what a name means.
 * - A query about a module answers as that module checked whole, so an answer never depends on
 *   what was asked before it.
 */

import type { Entity, NamespaceEntity, VariableEntity, VariantEntity } from '../binder/entities.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Identifier } from '../syntax/node.ts';
import type { SyntaxNode } from '../syntax/tree.ts';
import type { TypeNode } from '../syntax/types.ts';
import type { CheckedBody, VariantMember } from './check.ts';
import type { FieldMember, Type } from './types/type.ts';

/** What names a type: a declared one, a primitive, or `Self` inside a trait. */
type TypeNaming = Extract<Entity, { readonly kind: 'type' | 'primitive' | 'self' }>;

/**
 * A declaration an identifier names: a variable (a parameter, a constant, a binding or a local
 * function among them), a field or a variant; a function, a type or a namespace.
 */
type Declared =
  | { readonly kind: 'variable'; readonly entity: VariableEntity }
  | { readonly kind: 'field'; readonly field: FieldMember }
  | { readonly kind: 'variant'; readonly entity: VariantEntity }
  | { readonly kind: 'function'; readonly declaration: FunctionDeclaration }
  | { readonly kind: 'type'; readonly entity: TypeNaming }
  | { readonly kind: 'namespace'; readonly entity: NamespaceEntity };

/**
 * What an identifier denotes: the declaration it names, and its type there: an expression's as
 * checked, a declared name's, a field's or a type's, a written type's with its type arguments, a
 * variant's enum; undefined where it has none.
 */
export interface Denotation {
  readonly declared: Declared;
  readonly type: Type | undefined;
}

/** What a value of a type has, by name (§3.1, §3.7, §3.10, §3.11). */
export interface TypeMembers {
  readonly fields: readonly FieldMember[];
  readonly variants: readonly VariantMember[];
  /** Functions taking it as `self`, among those its module sees and those beside the type (§3.13). */
  readonly methods: readonly FunctionDeclaration[];
  /** Functions declared on the type, `fn Type.name`, that its module sees (§3.7). */
  readonly statics: readonly FunctionDeclaration[];
}

/** What tools ask of a checked program, by module and node. */
export interface LookupQueries {
  /**
   * What `name`, an identifier of `module`, denotes: nothing for a name that denotes nothing, two
   * for a shorthand, `Pair{first}` or `case Pair{first}`, which names a field and a variable.
   */
  readonly denotationsOf: (module: ModuleId, name: Identifier) => readonly Denotation[];
  /**
   * The checked body holding `node` of `module`: a function's, its parameters' defaults, a
   * struct's or variant's field defaults, a constant's, or an annotation's; undefined outside them.
   */
  readonly bodyHolding: (module: ModuleId, node: SyntaxNode) => CheckedBody | undefined;
  /**
   * The type the written type `node` of `module` denotes; undefined where checking resolved none,
   * such as a pattern's or a struct literal's type, or a constraint's trait.
   */
  readonly typeOfNode: (module: ModuleId, node: TypeNode) => Type | undefined;
  /** What a value of `type` has, as `module` sees it. */
  readonly membersOf: (module: ModuleId, type: Type) => TypeMembers;
}
