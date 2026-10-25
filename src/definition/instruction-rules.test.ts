/**
 * Load rules for a place's element steps: the functions an element step names must take a
 * container and a key to read it, and `&container`, key and value to write it, and must run at
 * once, so neither may be async (spec §3.7, §3.9).
 */

import { describe, expect, it } from 'vitest';
import { at, editedSubset, instructionAt } from './definition.test-kit.ts';
import { definitionFormat } from './definition.ts';
import { type EditableText, refusalOf } from './format.test-kit.ts';

describe('element steps', () => {
  it.each<[string, (json: EditableText) => void, string, string]>([
    [
      'an element written by a function that takes no &container',
      (json) => {
        const { span } = instructionAt(json, 4, 12);
        at(json, 'functions', 4, 'instructions')[12] = {
          kind: 'store',
          span,
          place: { register: 7, path: [{ kind: 'element', key: 0, read: 1, write: 1 }] },
          value: 0,
        };
      },
      'an element is written by prelude.add, which must take &container, key and value',
      'functions[4].instructions[12]',
    ],
    [
      'an element read by an async function',
      (json) => {
        const { span } = instructionAt(json, 4, 12);
        Object.assign(at(json, 'functions', 3), { async: true });
        const path = [{ kind: 'element', key: 0, read: 3, write: 3 }];
        at(json, 'functions', 4, 'instructions')[12] = {
          kind: 'store',
          span,
          place: { register: 7, path },
          value: 0,
        };
      },
      'which is async but must run at once',
      'functions[4].instructions[12]',
    ],
  ])('refuses %s', (_case, edit, problem, where) => {
    const message = refusalOf(definitionFormat, editedSubset(edit));
    expect(message).toContain(problem);
    expect(message).toContain(where);
  });
});
