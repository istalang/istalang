/**
 * A Definition's references into its own tables, functions, types, constants and modules, found by
 * walking its schema, where each kind has a schema of its own (operands.ts), never by knowing its
 * shapes: an instruction or a table field that comes to refer to an entry is walked as it is
 * declared.
 *
 * - **Compiled once per schema** and kept: a part whose schema holds no reference is passed on as it
 *   is, never visited. A recursive schema is taken to hold one.
 * - **Unchanged parts are shared:** an object or array is copied only where a reference inside it
 *   changes, and an absent optional field stays absent.
 * - **A union's value picks its branch** as Avro's does (formats/avro/branches.ts), so a union the
 *   codec can write is one this walks.
 */

import type { z } from 'zod';
import { branchChooser, discriminatorOf, leafBranch } from './formats/avro/branches.ts';
import { constantId, functionId, moduleId, typeId } from './operands.ts';

/** A zod schema of any kind, as the walk reads it. */
type ZodSchema = z.core.$ZodType;

/** The new number of each kind of reference, by its old one; a kind left out keeps its numbers. */
export interface Renumbering {
  readonly function?: (id: number) => number;
  readonly type?: (id: number) => number;
  readonly constant?: (id: number) => number;
  readonly module?: (id: number) => number;
}

/** `value`, of `schema`, with each reference it holds renumbered by `renumbering`. */
export function renumbered<T>(schema: ZodSchema, value: T, renumbering: Renumbering): T {
  const walk = walkOf(schema);
  return walk === undefined ? value : (walk.visit(value, renumbering) as T);
}

/** How a part's value is walked, its references renumbered. */
interface Walk {
  visit: (value: unknown, renumbering: Renumbering) => unknown;
}

const referenceKinds = new Map<ZodSchema, keyof Renumbering>([
  [functionId, 'function'],
  [typeId, 'type'],
  [constantId, 'constant'],
  [moduleId, 'module'],
]);

/** Each schema's walk, undefined where it holds no reference; one being compiled stands for itself. */
const walks = new Map<ZodSchema, Walk | undefined>();

function walkOf(schema: ZodSchema): Walk | undefined {
  if (walks.has(schema)) {
    return walks.get(schema);
  }
  const walk: Walk = { visit: (value) => value };
  walks.set(schema, walk);
  const compiled = compile(schema);
  walks.set(schema, compiled);
  if (compiled !== undefined) {
    walk.visit = compiled.visit;
  }
  return compiled;
}

function compile(schema: ZodSchema): Walk | undefined {
  const kind = referenceKinds.get(schema);
  if (kind !== undefined) {
    return { visit: (value, renumbering) => renumbering[kind]?.(value as number) ?? value };
  }
  const { def } = (schema as z.core.$ZodTypes)._zod;
  switch (def.type) {
    case 'object':
      return objectWalk(def.shape);
    case 'array':
      return arrayWalk(walkOf(def.element));
    case 'tuple':
      return tupleWalk(def.items.map(walkOf));
    case 'union':
    case 'optional':
      return unionWalk(schema);
    case 'pipe':
      return walkOf(def.out);
    default:
      return undefined;
  }
}

function objectWalk(shape: Readonly<Record<string, ZodSchema>>): Walk | undefined {
  const fields = Object.entries(shape).flatMap(([name, type]) => {
    const walk = walkOf(type);
    return walk === undefined ? [] : [{ name, walk }];
  });
  if (fields.length === 0) {
    return undefined;
  }
  return {
    visit: (value, renumbering) => {
      const object = value as Readonly<Record<string, unknown>>;
      let copy: Record<string, unknown> | undefined;
      for (const { name, walk } of fields) {
        const before = object[name];
        const after = before === undefined ? before : walk.visit(before, renumbering);
        if (after !== before) {
          copy ??= { ...object };
          copy[name] = after;
        }
      }
      return copy ?? object;
    },
  };
}

function arrayWalk(element: Walk | undefined): Walk | undefined {
  if (element === undefined) {
    return undefined;
  }
  return { visit: (value, renumbering) => sameOr(value as unknown[], element, renumbering) };
}

function tupleWalk(items: readonly (Walk | undefined)[]): Walk | undefined {
  if (items.every((item) => item === undefined)) {
    return undefined;
  }
  return {
    visit: (value, renumbering) => {
      const tuple = value as readonly unknown[];
      const after = tuple.map((each, at) => items[at]?.visit(each, renumbering) ?? each);
      return after.every((each, at) => each === tuple[at]) ? tuple : after;
    },
  };
}

/** `values`, each walked by `walk`, or the same array where none changes. */
function sameOr(values: readonly unknown[], walk: Walk, renumbering: Renumbering): unknown {
  let copy: unknown[] | undefined;
  values.forEach((each, at) => {
    const after = walk.visit(each, renumbering);
    if (after !== each) {
      copy ??= [...values];
      copy[at] = after;
    }
  });
  return copy ?? values;
}

function unionWalk(schema: ZodSchema): Walk | undefined {
  const leaves = leavesOf(schema);
  const branches = leaves.map((leaf) =>
    leaf === undefined
      ? { schema: undefined, bucket: 'absent' as const, tags: new Map() }
      : leafBranch(leaf, walkOf(leaf)),
  );
  if (branches.every((branch) => branch.schema === undefined)) {
    return undefined;
  }
  const chosen = branchChooser(branches, discriminatorOf(schema));
  return {
    visit: (value, renumbering) =>
      branches[chosen(value)]?.schema?.visit(value, renumbering) ?? value,
  };
}

/** A union's leaves, nested unions flattened, an optional's absent value as undefined. */
function leavesOf(schema: ZodSchema): readonly (ZodSchema | undefined)[] {
  const { def } = (schema as z.core.$ZodTypes)._zod;
  switch (def.type) {
    case 'union':
      return def.options.flatMap(leavesOf);
    case 'optional':
      return [undefined, ...leavesOf(def.innerType)];
    case 'pipe':
      return leavesOf(def.out);
    default:
      return [schema];
  }
}
