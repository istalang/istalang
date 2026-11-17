/**
 * Where a Definition's tables refer to each other outside code (index.ts checks code's operands):
 * every index lands in its table, and no constant or annotation holds a handle, which names a heap
 * object of a running instance (../values/values.ts).
 *
 * - What each place holds is listed apart from how it is checked: a table's entries name their
 *   places (`Held`), and one check reads them all.
 * - Bytes are read without their zod schema (../definition.ts), so an index may be negative too.
 * - Values are walked on a stack of their own: a constant nests as deep as a value may.
 */

import { pushAll } from '../../foundation/structures/stack.ts';
import type { FunctionDefinition } from '../tables/functions.ts';
import type { Tables } from '../tables/index.ts';
import { type Field, type TypeDefinition, type TypeReference, typesIn } from '../tables/types.ts';
import { childValues, isComposite, type Value } from '../values/values.ts';

type Table = 'type' | 'function' | 'module';

/** An index into one of the tables. */
interface Index {
  readonly table: Table;
  readonly index: number;
}

/** What one place in the tables holds: an index into a table, a type, or a value. */
type Held =
  | ({ readonly kind: 'index' } & Index)
  | { readonly kind: 'type'; readonly type: TypeReference }
  | { readonly kind: 'value'; readonly value: Value };

/** A place in the tables, named for an issue, and what it holds. */
interface Holding {
  readonly where: string;
  readonly held: Held;
}

/** The issue of `index` outside a table of `size` (`of` names it), or undefined where it lands. */
export function outsideIssue(
  what: string,
  index: number,
  size: number,
  of = 'table',
): string | undefined {
  return index < 0 || index >= size
    ? `${what} ${String(index)} is outside the ${of}'s ${String(size)}.`
    : undefined;
}

/** Every way `definition`'s tables break the rules above, each naming where. */
export function referenceIssues(definition: Tables): readonly string[] {
  const sizes: Record<Table, number> = {
    type: definition.types.length,
    function: definition.functions.length,
    module: definition.modules.length,
  };
  const outside = ({ table, index }: Index) => outsideIssue(table, index, sizes[table]);
  const issuesOf = (held: Held): readonly (string | undefined)[] => {
    switch (held.kind) {
      case 'index':
        return [outside(held)];
      case 'type':
        return typesIn(held.type).map((index) => outside({ table: 'type', index }));
      case 'value':
        return valueIssues(held.value, outside);
      default: {
        const unhandled: never = held;
        return unhandled;
      }
    }
  };
  return holdingsOf(definition).flatMap(({ where, held }) =>
    issuesOf(held).flatMap((issue) => (issue === undefined ? [] : [`${where}: ${issue}`])),
  );
}

function holdingsOf(definition: Tables): readonly Holding[] {
  return [
    ...definition.types.flatMap((entry, at) =>
      typeHoldings(entry, `type ${String(at)} (${entry.name})`),
    ),
    ...definition.functions.flatMap((entry, at) =>
      functionHoldings(entry, `function ${String(at)} (${entry.name})`),
    ),
    ...definition.constants.map((value, at) => valueAt(`constant ${String(at)}`, value)),
    ...definition.starts.flatMap((start) => [
      ...functionAt(`start ${start.key}`, start.function),
      ...functionAt(`start ${start.key}'s encoding`, start.encode),
    ]),
  ];
}

function typeHoldings(entry: TypeDefinition, where: string): readonly Holding[] {
  const declared = entry.arguments.map((type) => typeAt(`${where} argument`, type));
  switch (entry.kind) {
    case 'struct':
      return [...declared, ...fieldHoldings(entry.fields, where)];
    case 'enum':
      return [
        ...declared,
        ...entry.variants.flatMap(({ name, fields }) =>
          fieldHoldings(fields, `${where} variant ${name}`),
        ),
      ];
    case 'shared':
      return [
        ...declared,
        { where: `${where} value`, held: { kind: 'index', table: 'type', index: entry.value } },
        ...functionAt(`${where} dispose`, entry.dispose),
      ];
    case 'extern':
      return [
        ...declared,
        ...functionAt(`${where} dispose`, entry.dispose),
        ...functionAt(`${where} encoder`, entry.encoder),
      ];
    case 'alias':
      return [...declared, typeAt(`${where} aliased`, entry.type)];
    default: {
      const unhandled: never = entry;
      return unhandled;
    }
  }
}

function fieldHoldings(fields: readonly Field[], owner: string): readonly Holding[] {
  return fields.flatMap(({ name, type, annotations }) => [
    typeAt(`${owner} field ${name}`, type),
    ...annotations.map((value) => valueAt(`${owner} field ${name} annotation`, value)),
  ]);
}

function functionHoldings(entry: FunctionDefinition, where: string): readonly Holding[] {
  const common = [
    { where: `${where} module`, held: { kind: 'index', table: 'module', index: entry.module } },
    ...entry.annotations.map((value) => valueAt(`${where} annotation`, value)),
  ] as const;
  return entry.kind === 'code'
    ? [
        ...common,
        ...entry.registers.map(({ type }, at) => typeAt(`${where} register ${String(at)}`, type)),
      ]
    : [
        ...common,
        ...entry.parameters.map(({ type }) => typeAt(`${where} parameter`, type)),
        typeAt(`${where} result`, entry.result),
      ];
}

function typeAt(where: string, type: TypeReference): Holding {
  return { where, held: { kind: 'type', type } };
}

function valueAt(where: string, value: Value): Holding {
  return { where, held: { kind: 'value', value } };
}

function functionAt(where: string, index: number | undefined): readonly Holding[] {
  return index === undefined ? [] : [{ where, held: { kind: 'index', table: 'function', index } }];
}

/** What `value` holds at any depth that breaks the rules above, through `outside` for its indices. */
function valueIssues(
  value: Value,
  outside: (index: Index) => string | undefined,
): readonly (string | undefined)[] {
  const issues: (string | undefined)[] = [];
  const pending: Value[] = [value];
  for (let part = pending.pop(); part !== undefined; part = pending.pop()) {
    if (isComposite(part)) {
      if (part.kind === 'struct' || part.kind === 'variant' || part.kind === 'extern') {
        issues.push(outside({ table: 'type', index: part.type }));
      } else if (part.kind === 'closure') {
        issues.push(outside({ table: 'function', index: part.function }));
      } else if (part.kind === 'handle') {
        issues.push(`holds a handle, to object ${String(part.object)}.`);
      }
      pushAll(pending, childValues(part));
    }
  }
  return issues;
}
