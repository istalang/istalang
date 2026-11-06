/**
 * The fields a declaration or a `{…}` type writes, resolved where written (`declaredFields`), and
 * the field a field's declaring node declares (§3.1, §3.10, §3.11), as its owner's layout has it:
 * a struct's, an enum variant's, a shape's `{…}` type's, or a trait's required field, typed where
 * it is written. Annotations, which read a field's declared type, and the tools' denotations, which
 * show it, read fields here, each finding the owner its own way: one from the module's items, the
 * other from the node's ancestors.
 */

import type { ModuleId } from '../../../program/program.ts';
import type {
  DeclaredStruct,
  EnumDeclaration,
  Field,
  FunctionDeclaration,
  TraitDeclaration,
} from '../../../syntax/declarations.ts';
import type { Invalid } from '../../../syntax/node.ts';
import type { StructType, TypeNode } from '../../../syntax/types.ts';
import type { CheckerContext } from '../../context.ts';
import { errorType } from '../primitives.ts';
import type { FieldMember, Type } from '../type.ts';

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

/**
 * The fields of a struct declaration, an enum variant or an anonymous struct type, their types
 * resolved in `module`, where they are written, but not substituted. A field whose default gives
 * its type has its parameter's in `defaults`, the function its declaration's fields read as
 * (syntax/field-defaults.ts), whose defaults are checked to infer it (§3.1, §3.3). Each written
 * type resolves through `resolve`, the checker's resolution unless a recursive group is closing.
 */
export function declaredFields(
  checker: CheckerContext,
  module: ModuleId,
  fields: readonly (Field | Invalid)[],
  { defaults, resolve = (node) => checker.resolveType(module, node) }: FieldResolution = {},
): readonly FieldMember[] {
  const declared = fields.filter((field) => field.kind !== 'Invalid');
  return declared.map((field, index) => {
    const type =
      field.type === undefined ? defaultedType(checker, index, defaults) : resolve(field.type);
    return { name: field.name.text, type, declared: { node: field, module, type } };
  });
}

/** How written fields' types resolve: through a default's parameter, and how a written type does. */
interface FieldResolution {
  readonly defaults?: FunctionDeclaration | undefined;
  readonly resolve?: ((node: TypeNode) => Type) | undefined;
}

/** The type field `index`'s default gives it: its parameter's in `defaults`, read in order. */
function defaultedType(
  checker: CheckerContext,
  index: number,
  defaults: FunctionDeclaration | undefined,
): Type {
  return (
    (defaults === undefined ? undefined : checker.parametersOf(defaults)[index]?.type) ?? errorType
  );
}
