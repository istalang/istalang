/**
 * The modifiers a head stacks before its keyword, `fn` or `struct` (§2): a function's, a function
 * type's, a lambda's, an extern's or a struct's. They stack in any order, each at most once
 * and one word of each group, and print in one order, the groups': `extern`; what a value reaches
 * or which handle it is; the function's kind; whether it awaits. Parsing, completion and every printer read
 * these tables, so a modifier is added here alone.
 *
 * - A group's words exclude each other: a head is `sendable` or not, `live`, `ista` or neither,
 *   `async` or not, one handle.
 * - `sendable` before `fn` is the function's reach and before `struct` an extern struct's handle,
 *   `live` a function's kind or an extern struct's handle, and `shared` a handle or a shared
 *   struct's own word. The form tells them apart, so a word may stand in two groups no form holds
 *   together.
 * - A form is a head where it stands, with the groups it takes: a function type takes its reach,
 *   while a lambda's follows from its captures (§3.14).
 * - A function's qualifiers, its reach, kind and `async`, are what its type keeps of its head; a
 *   declaration's `extern` and an extern struct's handle stay on the declaration.
 */

import type { ContextualWord, Keyword } from './index.ts';

/** Each group's words, the groups in the order heads print them. */
export const modifierGroups = {
  extern: ['extern'],
  handle: ['shared', 'sendable', 'live'],
  shared: ['shared'],
  reach: ['sendable'],
  kind: ['live', 'ista'],
  async: ['async'],
} as const satisfies Record<string, readonly (Keyword | ContextualWord)[]>;

export type ModifierGroup = keyof typeof modifierGroups;

export type ModifierWord<Group extends ModifierGroup = ModifierGroup> =
  (typeof modifierGroups)[Group][number];

/** A head's modifiers by group. */
export type Modifiers = { readonly [Group in ModifierGroup]?: ModifierWord<Group> | undefined };

/**
 * What a function's head says of it: what its value may reach, the kind of code it is (proposal 8,
 * Rule 2), and whether its body may await.
 */
export interface FunctionQualifiers {
  readonly reach: ModifierWord<'reach'> | undefined;
  readonly kind: ModifierWord<'kind'> | undefined;
  readonly async: ModifierWord<'async'> | undefined;
}

export const plainQualifiers: FunctionQualifiers = {
  reach: undefined,
  kind: undefined,
  async: undefined,
};

/**
 * Whether a function of `qualifiers` is async: its body may await, and its call gives a future
 * (§3.14). The one reading of `async` outside the parser and the printers.
 */
export function awaits(qualifiers: FunctionQualifiers): boolean {
  return qualifiers.async !== undefined;
}

const groupOrder = Object.keys(modifierGroups) as readonly ModifierGroup[];

const modifierWordSet: ReadonlySet<string> = new Set(Object.values(modifierGroups).flat());

export function isModifierWord(word: string): word is ModifierWord {
  return modifierWordSet.has(word);
}

/** A head where it stands: its keyword, the groups it takes in their order, and its name. */
export interface HeadForm {
  readonly keyword: 'fn' | 'struct';
  readonly groups: readonly ModifierGroup[];
  readonly name: string;
}

export const headForms = {
  /** A defined, local or extern function's. */
  function: { keyword: 'fn', groups: ['extern', 'kind', 'async'], name: 'a function declaration' },
  requirement: { keyword: 'fn', groups: ['kind', 'async'], name: "a trait's function" },
  lambda: { keyword: 'fn', groups: ['kind', 'async'], name: 'a lambda' },
  functionType: { keyword: 'fn', groups: ['reach', 'kind', 'async'], name: 'a function type' },
  externStruct: { keyword: 'struct', groups: ['extern', 'handle'], name: 'an extern struct' },
  sharedStruct: { keyword: 'struct', groups: ['shared'], name: 'a shared struct' },
  struct: { keyword: 'struct', groups: [], name: 'a struct' },
} as const satisfies Record<string, HeadForm>;

/** The group of `form` holding `word`, if `form` takes it. */
export function groupIn(form: HeadForm, word: ModifierWord): ModifierGroup | undefined {
  return form.groups.find((group) => (modifierGroups[group] as readonly string[]).includes(word));
}

/**
 * What may follow `word` in a head of `form` written in print order: the form's keyword, or a
 * later group's modifier.
 */
export function followersIn(
  form: HeadForm,
  word: ModifierWord,
): readonly (Keyword | ContextualWord)[] {
  const group = groupIn(form, word);
  const later = group === undefined ? [] : form.groups.slice(form.groups.indexOf(group) + 1);
  return [form.keyword, ...later.flatMap((each) => modifierGroups[each])];
}

/** What may start a head of `form`: its keyword, or any of its modifiers. */
export function startsOf<Form extends HeadForm>(
  form: Form,
): readonly (Form['keyword'] | ModifierWord<Form['groups'][number]>)[] {
  return [form.keyword, ...form.groups.flatMap((group) => modifierGroups[group])];
}

/** A function's qualifiers among a head's modifiers. */
export function qualifiersOf({ reach, kind, async }: Modifiers): FunctionQualifiers {
  return { reach, kind, async };
}

/** `modifiers` as a head prints them, in their groups' order, each followed by a space. */
export function modifiersText(modifiers: Modifiers): string {
  return groupOrder
    .map((group) => (modifiers[group] === undefined ? '' : `${modifiers[group]} `))
    .join('');
}
