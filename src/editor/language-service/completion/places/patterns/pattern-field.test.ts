/**
 * What a struct pattern's braces offer (§11.3): the fields of the struct it names that its items
 * don't name yet, a downcast's against an `any` value, and none where its name is a variant's or
 * names what the matched value can't be.
 */

import { describe, expect, it } from 'vitest';
import { programAt } from '../../../language-service.test-kit.ts';
import { completionsAt } from '../../index.ts';
import { decision, labelsAt } from './pattern.test-kit.ts';

describe("a struct pattern's braces", () => {
  it("offers a struct's fields, but those its pattern names, in its braces", () => {
    const struct = ['struct Pair:', '  first: Int', '  second: Int', '', 'fn f(p: Pair) -> Int:'];
    expect(labelsAt(...struct, '  match p:', '    case Pair{first, ‸')).toEqual(['second']);
    expect(labelsAt(...struct, '  match p:', '    case struct{‸')).toEqual(['first', 'second']);
    // A parameter's pattern is completed before its function has a body.
    const bodiless = programAt(...struct.slice(0, 3), 'fn g(Pair{‸})');
    const offered = completionsAt(bodiless.program, bodiless.module, bodiless.offset);
    expect(offered.map(({ name }) => name)).toEqual(['first', 'second']);
  });

  it("offers no fields in braces naming what the matched value can't be, nor a variant's", () => {
    const struct = [
      'struct Pair:',
      '  first: Int',
      '  second: Int',
      '',
      'enum Color { Red, Green }',
    ];
    const cases = [...struct, ...decision, 'fn f(p: Pair, d: Decision) -> Int:'];
    expect(labelsAt(...cases, '  match p:', '    case Wrong{‸')).toEqual([]);
    expect(labelsAt(...cases, '  match p:', '    case Approved{‸')).toEqual([]);
    expect(labelsAt(...cases, '  match d:', '    case Color.Rejected{‸')).toEqual([]);
    expect(labelsAt(...cases, '  match d:', '    case Decision.Rejected{‸')).toEqual([]);
    expect(labelsAt(...cases, '  match (1, d, 2):', '    case (1, Rejected{‸')).toEqual([]);
    expect(labelsAt(...cases, '  match p:', '    case Pair{‸')).toEqual(['first', 'second']);
  });

  it("offers a downcast's fields against an `any` value, where it may downcast", () => {
    const named = [
      'trait HasId:',
      '  id: String',
      '',
      'struct User { id: String, name: String }',
      'struct Box<T> { id: String, value: T }',
      ...decision,
      'fn f(x: any HasId) -> Int:',
      '  match x:',
    ];
    expect(labelsAt(...named, '    case User{‸')).toEqual(['id', 'name']);
    expect(labelsAt(...named, '    case struct{‸')).toEqual([]);
    expect(labelsAt(...named, '    case Box{‸')).toEqual([]);
    expect(labelsAt(...named, '    case Rejected{‸')).toEqual([]);
  });
});
