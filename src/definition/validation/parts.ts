/**
 * Where code steps into a value's parts, each index lands among the parts its type has: a tuple's
 * elements, a struct's fields, an enum's variants and a variant's fields, read, built, switched on
 * or followed along a place's path. Operands' own indices are index.ts's.
 *
 * - The type stepped into is the register's (../tables/functions.ts): every register is typed, so
 *   a part's index is checked against the code alone.
 * - A recursive alias unfolds in one step to the tuple or function it names (index.ts holds it to
 *   that); nothing else changes a type's parts.
 */

import type { Instruction } from '../instructions/instruction.ts';
import type { Place, PlaceStep } from '../instructions/places.ts';
import type { Register } from '../operands.ts';
import type { CodeFunction } from '../tables/functions.ts';
import type { Field, TypeDefinition, TypeReference } from '../tables/types.ts';
import { outsideIssue } from './references.ts';

/** What the parts' checks read: the entry's registers and the type table. */
interface PartScope {
  readonly entry: CodeFunction;
  readonly types: readonly TypeDefinition[];
}

/** A type reached, or why it isn't. */
type Reached = { readonly type: TypeReference } | { readonly issue: string };

/** Every issue of `entry`'s instructions with a part, each naming where through `at`. */
export function partIssues(
  entry: CodeFunction,
  types: readonly TypeDefinition[],
  at: (pc: number, instruction: Instruction) => string,
): readonly string[] {
  const scope = { entry, types };
  return entry.instructions.flatMap((instruction, pc) =>
    instructionIssues(scope, instruction).map((issue) => `${at(pc, instruction)}: ${issue}`),
  );
}

function instructionIssues(scope: PartScope, i: Instruction): readonly string[] {
  switch (i.kind) {
    case 'struct':
      return issuesOf(builtStruct(scope, i.type, i.fields.length));
    case 'variant':
      return issuesOf(builtVariant(scope, i.type, i.variant, i.fields.length));
    case 'switch':
      return issuesOf(switched(scope, i.value, i.targets.length, i.otherwise !== undefined));
    case 'tupleItem':
      return issuesOf(placeType(scope, partOf(i.src, { kind: 'tuple', index: i.index })));
    case 'structField':
      return issuesOf(placeType(scope, partOf(i.src, { kind: 'field', field: i.field })));
    case 'variantField':
      return issuesOf(
        placeType(scope, partOf(i.src, { kind: 'variant', variant: i.variant, field: i.field })),
      );
    case 'load':
    case 'store':
    case 'reference':
      return issuesOf(placeType(scope, i.place));
    default:
      return [];
  }
}

/** A part read of the value in `register` as the place it is: one step from that register. */
function partOf(register: Register, step: PlaceStep): Place {
  return { root: { kind: 'register', register }, path: [step] };
}

function issuesOf(reached: Reached | undefined): readonly string[] {
  return reached !== undefined && 'issue' in reached ? [reached.issue] : [];
}

/** `type` with its alias unfolded. */
function unfolded(scope: PartScope, type: TypeReference): TypeReference {
  const entry = type.kind === 'named' ? scope.types[type.type] : undefined;
  return entry?.kind === 'alias' ? entry.type : type;
}

/** The entry `type` names once unfolded; undefined where it names none. */
function entryOf(scope: PartScope, type: TypeReference): TypeDefinition | undefined {
  const reference = unfolded(scope, type);
  return reference.kind === 'named' ? scope.types[reference.type] : undefined;
}

function builtStruct(scope: PartScope, type: number, fields: number): Reached | undefined {
  const entry = scope.types[type];
  if (entry === undefined) {
    return undefined;
  }
  if (entry.kind !== 'struct') {
    return { issue: `type ${String(type)} (${entry.name}) is no struct.` };
  }
  return counted(`its ${String(fields)} fields`, fields, entry.fields.length, entry.name);
}

function builtVariant(
  scope: PartScope,
  type: number,
  variant: number,
  fields: number,
): Reached | undefined {
  const entry = scope.types[type];
  if (entry === undefined) {
    return undefined;
  }
  if (entry.kind !== 'enum') {
    return { issue: `type ${String(type)} (${entry.name}) is no enum.` };
  }
  const declared = partAt('variant', variant, entry.variants, entry.name);
  if ('issue' in declared) {
    return declared;
  }
  const { name, fields: declaredFields } = declared.part;
  return counted(
    `its ${String(fields)} fields`,
    fields,
    declaredFields.length,
    `${entry.name}.${name}`,
  );
}

/** A `switch` on `value`: one target per variant at most, and every variant's without `otherwise`. */
function switched(
  scope: PartScope,
  value: Register,
  targets: number,
  otherwise: boolean,
): Reached | undefined {
  const type = scope.entry.registers[value]?.type;
  if (type === undefined) {
    return undefined;
  }
  const entry = entryOf(scope, type);
  if (entry?.kind !== 'enum') {
    return { issue: `it switches on register ${String(value)}, of no enum.` };
  }
  const variants = entry.variants.length;
  if (targets > variants || (!otherwise && targets < variants)) {
    return {
      issue: `its ${String(targets)} targets don't cover ${entry.name}'s ${String(variants)} variants${otherwise ? '' : ' with no otherwise'}.`,
    };
  }
  return undefined;
}

/** The type of the value at `place`, following its path from its root. */
function placeType(scope: PartScope, place: Place): Reached | undefined {
  let reached = rootType(scope, place);
  for (const step of place.path) {
    if (reached === undefined || 'issue' in reached) {
      return reached;
    }
    reached = stepped(scope, reached.type, step);
  }
  return reached;
}

/**
 * What a place's root holds: a register's value, a cell's content, or what a reference refers to;
 * undefined where the register is outside the frame, which index.ts reports.
 */
function rootType(scope: PartScope, { root }: Place): Reached | undefined {
  const held = scope.entry.registers[root.register]?.type;
  if (held === undefined || root.kind === 'register') {
    return held === undefined ? undefined : { type: held };
  }
  const type = unfolded(scope, held);
  if (root.kind === 'reference') {
    return type.kind === 'reference'
      ? { type: type.to }
      : { issue: `register ${String(root.register)} holds no reference.` };
  }
  const entry = entryOf(scope, type);
  if (entry?.kind === 'shared') {
    return { type: { kind: 'named', type: entry.value } };
  }
  const content =
    entry?.kind === 'extern' && entry.role === 'cell' ? entry.arguments[0] : undefined;
  return content === undefined
    ? { issue: `register ${String(root.register)} holds no cell.` }
    : { type: content };
}

/** The type `step` reaches from `from`. */
function stepped(scope: PartScope, from: TypeReference, step: PlaceStep): Reached {
  const type = unfolded(scope, from);
  const entry = entryOf(scope, type);
  switch (step.kind) {
    case 'tuple':
      if (type.kind !== 'tuple') {
        return { issue: `it steps into element ${String(step.index)} of no tuple.` };
      }
      return within('element', step.index, type.elements, 'tuple');
    case 'field':
      if (entry?.kind !== 'struct') {
        return { issue: `it steps into field ${String(step.field)} of no struct.` };
      }
      return within('field', step.field, typesOf(entry.fields), entry.name);
    case 'variant': {
      if (entry?.kind !== 'enum') {
        return { issue: `it steps into variant ${String(step.variant)} of no enum.` };
      }
      const variant = partAt('variant', step.variant, entry.variants, entry.name);
      if ('issue' in variant) {
        return variant;
      }
      const { name, fields } = variant.part;
      return within('field', step.field, typesOf(fields), `${entry.name}.${name}`);
    }
    default: {
      const unhandled: never = step;
      return unhandled;
    }
  }
}

/** Part `index` of `parts`, or why it is outside them (`of` names their owner). */
function partAt<Part>(
  what: string,
  index: number,
  parts: readonly Part[],
  of: string,
): { readonly part: Part } | { readonly issue: string } {
  const issue = outsideIssue(what, index, parts.length, of);
  // `outsideIssue` is undefined exactly where `index` lands among `parts`.
  return issue === undefined ? { part: parts[index] as Part } : { issue };
}

/** The type of part `index` of `parts`, or why it is outside them. */
function within(what: string, index: number, parts: readonly TypeReference[], of: string): Reached {
  const found = partAt(what, index, parts, of);
  return 'issue' in found ? found : { type: found.part };
}

function typesOf(fields: readonly Field[]): readonly TypeReference[] {
  return fields.map(({ type }) => type);
}

function counted(what: string, given: number, declared: number, of: string): Reached | undefined {
  return given === declared ? undefined : { issue: `${what} aren't ${of}'s ${String(declared)}.` };
}
