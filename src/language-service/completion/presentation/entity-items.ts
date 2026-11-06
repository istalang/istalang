/**
 * How a name a scope offers shows (present.ts): what the binder says it denotes decides its kind,
 * its detail and its docstring, as hover reads them (docstrings.ts, signatures.ts), so the two
 * never disagree.
 *
 * - A name's group is where it comes from: declared inside a function (a local), at its module's
 *   top level, imported, or the prelude's, as the language's own names are (primitives, and the
 *   variants a bare name may denote).
 * - A name that reads as a value or a type commits on `.`, the one character that goes on with it.
 * - A method named bare gives no value that fits: its value is reached through a receiver.
 * - An annotation's struct, named after its `@`, opens its literal's braces where it has fields
 *   (§3.16), as nothing but its value can follow it there; elsewhere a type's name may go on with
 *   a `.` as well.
 */

import {
  type Entity,
  localFunctionOf,
  type VariableEntity,
} from '../../../compiler/binder/entities.ts';
import type { Checker } from '../../../compiler/checker/check.ts';
import { nominalType, type Type } from '../../../compiler/checker/types/type/index.ts';
import { typeText } from '../../../compiler/checker/types/type-text.ts';
import type { ModuleId } from '../../../compiler/program/program.ts';
import { isMethod } from '../../../compiler/syntax/declarations/index.ts';
import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import { docstringOf } from '../../docstrings.ts';
import { importedModule } from '../../namespaces.ts';
import { signatureOf } from '../../signatures/signatures.ts';
import type { CompletionKind, RankGroup } from './item.ts';
import { called, constructed, documented, type Presenting, type Shown } from './presenting.ts';

/** How `entity`, offered as `name`, shows. */
export function shownEntity(presenting: Presenting, entity: Entity, name: string): Shown {
  const { checker, module } = presenting.cursor;
  return {
    group: groupOf(checker, module, entity),
    ...handlerOf(entityItems, entity)(presenting, entity, name),
  };
}

/** Where `entity` comes from, seen from `module`. */
export function groupOf(checker: Checker, module: ModuleId, entity: Entity): RankGroup {
  if (entity.kind === 'namespace') {
    return 'imported';
  }
  const home = checker.bindings.moduleOf(entity);
  if (home === undefined || home === checker.program.roles.prelude) {
    return 'prelude';
  }
  if (home !== module) {
    return 'imported';
  }
  return entity.kind === 'variant' || checker.bindings.isTopLevel(entity) ? 'module' : 'local';
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
/** A declared type's kind, and the word its detail reads. */
const typeKinds = {
  StructDeclaration: ['struct', 'struct'],
  SharedStructDeclaration: ['struct', 'shared struct'],
  ExternStructDeclaration: ['struct', 'extern struct'],
  EnumDeclaration: ['enum', 'enum'],
  TraitDeclaration: ['trait', 'trait'],
  TypeAliasDeclaration: ['type', 'type'],
  AssociatedType: ['type', 'associated type'],
  RequiredAssociatedType: ['type', 'associated type'],
  TypeParameter: ['typeParameter', 'type parameter'],
} as const satisfies Record<
  Extract<Entity, { kind: 'type' }>['declaration']['kind'],
  readonly [CompletionKind, string]
>;
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

const goesOn = ['.'];

const entityItems: Handlers<Presenting, Entity, [name: string], Shown> = {
  variable: ({ cursor: { checker } }, entity) => {
    const type = variableType(checker, entity);
    return {
      kind: variableKind(checker, entity),
      ...(type === undefined ? {} : { detail: typeText(type), gives: [type] }),
      ...documented(docstringOf(checker, { kind: 'variable', entity })),
      commit: goesOn,
    };
  },
  functions: (presenting, { overloads }, name) => {
    const { checker } = presenting.cursor;
    const [first] = overloads;
    return {
      kind: 'function',
      ...(first === undefined
        ? {}
        : {
            detail: signatureOf(checker, first).label,
            ...documented(docstringOf(checker, { kind: 'function', declaration: first })),
          }),
      gives: overloads.flatMap((overload) =>
        isMethod(overload) ? [] : [checker.resultOf(overload)],
      ),
      ...called(presenting, name),
    };
  },
  type: (presenting, entity, name) => {
    const { checker } = presenting.cursor;
    const [kind, detail] = typeKinds[entity.declaration.kind];
    return {
      kind,
      detail,
      ...documented(docstringOf(checker, { kind: 'type', entity })),
      commit: goesOn,
      ...(presenting.place.kind === 'annotation'
        ? constructed(
            presenting,
            name,
            (checker.fieldsOf(nominalType(entity, []))?.length ?? 0) > 0,
          )
        : {}),
    };
  },
  primitive: () => ({ kind: 'keyword', commit: goesOn }),
  self: () => ({ kind: 'typeParameter', commit: goesOn }),
  variant: (presenting, { enum: declaration, variant }, name) => ({
    kind: 'variant',
    detail: declaration.name.text,
    order: declaration.variants.indexOf(variant),
    ...constructed(presenting, name, variant.fields.length > 0),
  }),
  variants: () => ({ kind: 'variant' }),
  namespace: ({ cursor: { checker } }, entity) => {
    const imported = importedModule(checker, entity);
    return {
      kind: 'module',
      ...(imported === undefined ? {} : { detail: imported.name }),
      ...documented(docstringOf(checker, { kind: 'namespace', entity })),
      commit: goesOn,
    };
  },
};

function variableKind(checker: Checker, entity: VariableEntity): CompletionKind {
  const { owner } = entity;
  if (localFunctionOf(entity) !== undefined) {
    return 'function';
  }
  const isConstant =
    owner.kind === 'ExternConstantDeclaration' ||
    (owner.kind === 'VariableDeclaration' &&
      !owner.isMutable &&
      checker.bindings.isTopLevel(entity));
  return isConstant ? 'constant' : 'variable';
}

/** The type `entity` holds, as its declaring module checks its name. */
function variableType(checker: Checker, entity: VariableEntity): Type | undefined {
  const module = checker.bindings.moduleOf(entity);
  return module === undefined
    ? undefined
    : checker.lookup.denotationsOf(module, entity.name)[0]?.type;
}
