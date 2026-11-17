/**
 * Every kind of function-table entry lowering makes, in one typed table: how the tables tell two
 * of a kind apart (tables/entries.ts) and what its entry is. A new kind fails to compile until it
 * has a row, which is all it needs beside its variant.
 *
 * An instance's entry is made of what its own entry is (tables/own-entries.ts), in a table of its
 * own: a function with a body becomes code computing the defaults its call leaves out before its
 * body, a struct's or a variant's fields code building it, and an extern an entry bound to its
 * native by key, beside code computing its defaults for a call leaving them out.
 */

import type { FunctionDefinition } from '../../definition/tables/functions.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { type FunctionInstance, substitutionOf } from '../checker/surface/witness-closing.ts';
import { substitute } from '../checker/types/parts/substitution.ts';
import type { Lowering } from './context.ts';
import { writtenBodyOf } from './functions/bodies.ts';
import {
  constructorEntry,
  externDefaultsEntry,
  hostExternEntry,
  primitiveEntry,
  structEntry,
} from './functions/built-entries.ts';
import { convertingEntry, wrappingEntry } from './functions/fits/index.ts';
import { accessorLowering, instanceLowering, nestedLowering } from './functions/index.ts';
import { derivedCodecEntry } from './synthesized/boundary/codecs.ts';
import {
  constantNativeEntry,
  hostConstantEntry,
  hostNativeEntry,
} from './synthesized/boundary/host-externs.ts';
import { startableOf, startEncodeEntry, startEntry } from './synthesized/boundary/starts.ts';
import { anyConversionEntry, anyFieldEntry, dispatchEntry } from './synthesized/trait-objects.ts';
import type {
  EntryIdentity,
  EntryKind,
  EntryOf,
  LoweredEntry,
  StartTarget,
} from './tables/entries.ts';
import { keyOf } from './tables/extern-keys.ts';
import { instanceKey, nestedKey, ownerDeclaration } from './tables/instances.ts';
import { qualifiedNameOf } from './tables/names.ts';
import { type OwnEntry, ownEntryOf } from './tables/own-entries.ts';
import { parameterTypeOf } from './tables/parameter-types.ts';

/** One kind of entry: how the tables tell two apart, and what lowering makes of one. */
interface EntryKindRow<Kind extends EntryKind> extends EntryIdentity<Kind> {
  readonly entry: (lowering: Lowering, entry: EntryOf<Kind>) => FunctionDefinition;
}

export const entryKinds: { readonly [Kind in EntryKind]: EntryKindRow<Kind> } = {
  instance: {
    identity: (keys, { instance }) => instanceKey(keys, instance),
    body: (keys, { instance }) => keys.declaration(instance.declaration),
    entry: (lowering, { instance }) => {
      const own = ownEntryOf(lowering.checker, instance);
      return handlerOf(ownEntries, own)(lowering, own, instance);
    },
  },
  externDefaults: {
    identity: (keys, { instance }) => instanceKey(keys, instance),
    body: (keys, { instance }) => keys.declaration(instance.declaration),
    entry: (lowering, { instance }) => externDefaultsEntry(lowering, instance),
  },
  nested: {
    identity: (keys, { nested }) => nestedKey(keys, nested),
    body: (keys, { nested }) => keys.node(nested.node.span, ownerDeclaration(nested.owner)),
    entry: (lowering, { nested }) => nestedLowering(lowering, nested).lowerNested(nested.node),
  },
  hostNative: {
    identity: (keys, { declaration }) => keys.declaration(declaration),
    entry: (lowering, { declaration }) => hostNativeEntry(lowering, declaration),
  },
  constantNative: {
    identity: (keys, { declaration }) => keys.declaration(declaration),
    entry: (lowering, { declaration, type }) => constantNativeEntry(lowering, declaration, type),
  },
  externConstant: {
    identity: (keys, { declaration }) => keys.declaration(declaration),
    entry: (lowering, { declaration, type }) => hostConstantEntry(lowering, declaration, type),
  },
  contextConstant: {
    identity: (keys, { declaration }) => keys.declaration(declaration),
    entry: (lowering, { declaration }) =>
      accessorLowering(lowering, declaration).lowerAccessor(
        declaration,
        qualifiedNameOf(lowering.checker, declaration),
      ),
  },
  start: {
    identity: (keys, { target }) => keys.declaration(target),
    entry: (lowering, { target }) => startEntry(lowering, startedBy(lowering, target)),
  },
  startEncode: {
    identity: (keys, { target }) => keys.declaration(target),
    entry: (lowering, { target }) => startEncodeEntry(lowering, startedBy(lowering, target)),
  },
  converting: {
    identity: (keys, { from, to }) => `${keys.type(from)}->${keys.type(to)}`,
    entry: convertingEntry,
  },
  wrapping: {
    identity: (keys, { from, to }) => `${keys.type(from)}->${keys.type(to)}`,
    entry: wrappingEntry,
  },
  dispatch: {
    identity: (keys, { dispatch }) => {
      const { on, through, constraint, member } = dispatch;
      const typeArguments = dispatch.typeArguments.map((type) => keys.type(type));
      const target = `${keys.type(on)}:${keys.type(through)}.${constraint}.${member}`;
      return `${target}<${typeArguments.join(',')}>`;
    },
    closing: true,
    entry: (lowering, { dispatch }) => dispatchEntry(lowering, dispatch),
  },
  anyConversion: {
    identity: (keys, { from, to }) => `${keys.type(from)}->${keys.type(to)}`,
    closing: true,
    entry: (lowering, { from, to }) => anyConversionEntry(lowering, from, to),
  },
  anyField: {
    identity: (keys, { on, required }) => `${keys.type(on)}.${required.field.name.text}`,
    closing: true,
    entry: anyFieldEntry,
  },
};

/** The entry `entry` stands for. */
export function loweredEntry(lowering: Lowering, entry: LoweredEntry): FunctionDefinition {
  const row = entryKinds[entry.kind] as EntryKindRow<EntryKind>;
  return row.entry(lowering, entry);
}

/** What a host starts as `target`, which a start entry was made for. */
function startedBy(lowering: Lowering, target: StartTarget) {
  return (
    startableOf(lowering.checker, target) ??
    unreachable('A start entry was made for what no host can start.')
  );
}

/** The entry of an instance, by what its own entry is made of. */
const ownEntries: Handlers<Lowering, OwnEntry, [FunctionInstance], FunctionDefinition> = {
  struct: (lowering, _, instance) => structEntry(lowering, instance),
  constructor: (lowering, _, instance) => constructorEntry(lowering, instance),
  derivedCodec: (lowering, { direction }, instance) =>
    derivedCodecEntry({ ...lowering, instance }, direction),
  hostExtern: (lowering, _, instance) => hostExternEntry(lowering, instance),
  body: (lowering, _, instance) => bodyEntry(lowering, instance),
  primitive: (lowering, { op }, instance) => primitiveEntry(lowering, instance, op),
  native: (lowering, _, instance) => nativeEntry(lowering, instance),
};

/** The code of `instance`'s function, its body. */
function bodyEntry(lowering: Lowering, instance: FunctionInstance): FunctionDefinition {
  const { checker } = lowering;
  const { declaration } = instance;
  const lowered = instanceLowering(lowering, instance);
  const body = writtenBodyOf(checker.program, checker.moduleOf(declaration), declaration);
  if (lowered === undefined || body === undefined) {
    unreachable(`${declaration.name.text} has no body to lower.`);
  }
  return lowered.lower(body);
}

/** The entry binding `instance`, an extern, to its native by key, with its instance's types. */
function nativeEntry(lowering: Lowering, instance: FunctionInstance): FunctionDefinition {
  const { checker, tables } = lowering;
  const { declaration } = instance;
  const parameters = checker.parametersOf(declaration);
  const substitution = substitutionOf(instance);
  return {
    kind: 'extern',
    ...tables.entryHeader(instance),
    key: keyOf(checker, declaration, parameters),
    constant: false,
    parameters: parameters.map((parameter) => ({
      type: parameterTypeOf(tables.types, {
        type: substitute(parameter.type, substitution, checker.typeRules),
        reference: parameter.reference,
      }),
    })),
    result: tables.types.reference(
      substitute(checker.resultOf(declaration), substitution, checker.typeRules),
    ),
  };
}
