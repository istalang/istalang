/**
 * The field a field's declaring node declares (§3.1, §3.10, §3.11), as its owner's layout has it:
 * a struct's, an enum variant's, a shape's `{…}` type's, or a trait's required field, typed where
 * it is written. Annotations, which read a field's declared type, and the tools' denotations, which
 * show it, read fields here, each finding the owner its own way: one from the module's items, the
 * other from the node's ancestors.
 */

import type { ModuleId } from '../../program/program.ts';
import type {
  DeclaredStruct,
  EnumDeclaration,
  Field,
  TraitDeclaration,
} from '../../syntax/declarations.ts';
import type { StructType } from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import type { FieldMember } from './type.ts';

/** What declares a field: a struct, an enum through one of its variants, a shape or a trait. */
export type FieldOwner = DeclaredStruct | EnumDeclaration | StructType | TraitDeclaration;

/** The field `node` of `module` that `owner` declares; undefined when it declares none so. */
export function declaredFieldOf(
  checker: CheckerContext,
  module: ModuleId,
  owner: FieldOwner,
  node: Field,
): FieldMember | undefined {
  const declaredBy = (fields: readonly FieldMember[] | undefined) =>
    fields?.find(({ declared }) => declared?.node === node);
  switch (owner.kind) {
    case 'StructDeclaration':
    case 'SharedStructDeclaration':
      return declaredBy(checker.declaredFieldsOf(owner));
    case 'EnumDeclaration':
      return declaredBy(checker.declaredVariantsOf(owner).flatMap((variant) => variant.fields));
    case 'StructType': {
      const type = checker.resolvedTypeOf(owner);
      return declaredBy(type === undefined ? undefined : checker.fieldsOf(type));
    }
    case 'TraitDeclaration': {
      if (node.kind !== 'FieldDeclaration' || !owner.members.includes(node)) {
        return undefined;
      }
      const type = checker.resolveType(module, node.type);
      return { name: node.name.text, type, declared: { node, module, type } };
    }
    default: {
      const unhandled: never = owner;
      return unhandled;
    }
  }
}
