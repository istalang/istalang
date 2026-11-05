/**
 * The types a type is built from, one level down, and a type rebuilt from new ones: the one order
 * every walk over a type's parts reads them in (type-parts.ts, the term graphs of recursive types).
 *
 * - A recursive type (§3.17) is a node of a cyclic graph, so walking into its body would never end:
 *   what it is built from is its graph's parts, each largest type inside a node's body that refers
 *   to no node of the graph. They are what substitution replaces and what a walk looking for type
 *   parameters, errors or nominal types finds; the graph itself is rebuilt from them
 *   (recursive-types.ts). A graph's parts hold no recursive type: closing a graph copies in the
 *   nodes of every graph it reaches.
 */

import { memo } from '../../../structures/memo.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { RecursiveGraph } from './computed-types.ts';
import type { Type } from './type.ts';

/** Each graph's parts, which never change: a graph is immutable. */
const graphPartsOf = new WeakMap<RecursiveGraph, readonly Type[]>();

/** Whether each type holds a recursive type at any depth. */
const recursionHeld = new WeakMap<Type, boolean>();

/** The types `type` is built from, one level down. */
export function typeChildren(type: Type): readonly Type[] {
  switch (type.kind) {
    case 'nominal':
      return type.arguments;
    case 'anonymous':
      return type.fields.map((field) => field.type);
    case 'tuple':
      return type.elements;
    case 'function':
      return [
        ...type.parameters.map((parameter) => parameter.type),
        ...(type.pack === undefined ? [] : [type.pack]),
        type.result,
      ];
    case 'any':
      return type.constraints.flatMap((constraint) => constraint.arguments);
    case 'union':
      return type.members;
    case 'associated':
      return [type.of];
    case 'field':
      return [type.of, type.key];
    case 'keys':
      return [type.of];
    case 'mapped':
      return [...type.named.map((field) => field.type), type.keys, type.value];
    case 'match':
    case 'recursiveMatch':
      return type.arguments;
    case 'recursive':
      return graphParts(type.graph);
    case 'parameter':
      return type.within === undefined ? [] : [type.within];
    case 'literal':
    case 'primitive':
    case 'error':
      return [];
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/**
 * `type` with the types it is built from replaced by `children`, given in `typeChildren`'s order,
 * still of its kind, written through no alias: a caller rebuilding a type's structure changes what
 * was written. A recursive type is rebuilt from its parts by closing its graph again, not here.
 */
export function withTypeChildren(type: Type, children: readonly Type[]): Type {
  let next = 0;
  const child = (): Type => {
    next += 1;
    return children[next - 1] ?? unreachable('A type was rebuilt from fewer parts.');
  };
  const rebuilt = withPartsTaken(type, child);
  return rebuilt.alias === undefined ? rebuilt : { ...rebuilt, alias: undefined };
}

/** `type` rebuilt by `withTypeChildren`, each part taken from `child` in `typeChildren`'s order. */
function withPartsTaken(type: Type, child: () => Type): Type {
  switch (type.kind) {
    case 'anonymous':
      return {
        ...type,
        fields: type.fields.map((field) => {
          const fieldType = child();
          const { declared } = field;
          return declared === undefined
            ? { ...field, type: fieldType }
            : { ...field, type: fieldType, declared: { ...declared, type: fieldType } };
        }),
      };
    case 'function': {
      const parameters = type.parameters.map((parameter) => ({ ...parameter, type: child() }));
      const pack = type.pack === undefined ? undefined : child();
      const result = child();
      return pack === undefined || pack.kind === 'parameter' || pack.kind === 'error'
        ? { ...type, parameters, pack, result }
        : unreachable('A function type pack was rebuilt as no pack.');
    }
    case 'any':
      return {
        ...type,
        constraints: type.constraints.map((constraint) => ({
          ...constraint,
          arguments: constraint.arguments.map(child),
        })),
      };
    case 'mapped':
      return {
        ...type,
        named: type.named.map((field) => ({ ...field, type: child() })),
        keys: child(),
        value: child(),
      };
    case 'recursive':
      return unreachable('A recursive type is rebuilt by closing its graph.');
    default:
      return withListedParts(type, child);
  }
}

/** `type`, of a kind whose parts are a list or a few named ones, rebuilt from `child`. */
function withListedParts(type: Type, child: () => Type): Type {
  switch (type.kind) {
    case 'nominal':
    case 'match':
    case 'recursiveMatch':
      return { ...type, arguments: type.arguments.map(child) };
    case 'tuple':
      return { ...type, elements: type.elements.map(child) };
    case 'union':
      return { ...type, members: type.members.map(child) };
    case 'associated':
    case 'keys':
      return { ...type, of: child() };
    case 'field':
      return { ...type, of: child(), key: child() };
    case 'parameter':
      return type.within === undefined ? type : { ...type, within: child() };
    default:
      return type;
  }
}

/** The parts of `graph` (the banner): each largest type in a node's body naming no node of it. */
export function graphParts(graph: RecursiveGraph): readonly Type[] {
  return memo(graphPartsOf, graph, () => {
    const parts: Type[] = [];
    const visit = (type: Type): void => {
      if (type.kind === 'recursive' && type.graph === graph) {
        return;
      }
      if (namesNodeOf(type, graph)) {
        typeChildren(type).forEach(visit);
      } else {
        parts.push(type);
      }
    };
    for (const body of graph.nodes) {
      typeChildren(body).forEach(visit);
    }
    return parts;
  });
}

/** Whether `type` is, or is built from, a node of `graph`. */
export function namesNodeOf(type: Type, graph: RecursiveGraph): boolean {
  if (type.kind === 'recursive') {
    return type.graph === graph;
  }
  return typeChildren(type).some((child) => namesNodeOf(child, graph));
}

/** Whether `type` is, or is built from, a recursive type (§3.17). */
export function holdsRecursion(type: Type): boolean {
  return memo(
    recursionHeld,
    type,
    () => type.kind === 'recursive' || typeChildren(type).some(holdsRecursion),
  );
}
