/**
 * Where a body's flow releases its values (§7.1, §16), as lowering releases them: a block's
 * variables at its end and where an exit leaves it, a `hold(name)`'s kept there and released once,
 * where the scope it names ends, however it ends; a statement's temporaries at its end, a
 * condition's on each of its paths.
 */

import { describe, expect, it } from 'vitest';
import type { FlowFunction, Operation, ValueId } from '../../../surface/flow-ir.ts';
import { subjectFlow } from './flow.test-kit.ts';

/** How many times `flow` releases the variable named `name`, and by what. */
function releasesOf(flow: FlowFunction, name: string): readonly string[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.flatMap((operation) =>
      operation.op === 'release' &&
      operation.values.some((value) => {
        const found = flow.values[value];
        return found?.kind === 'variable' && found.entity.name.text === name;
      })
        ? [operation.reason]
        : [],
    ),
  );
}

/** The operations of `flow` of kind `op`, in block order. */
function operationsOf<Kind extends Operation['op']>(
  flow: FlowFunction,
  op: Kind,
): readonly Extract<Operation, { op: Kind }>[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.filter(
      (operation): operation is Extract<Operation, { op: Kind }> => operation.op === op,
    ),
  );
}

/** The temporaries of `flow` its statements compute, not the `Unit` a block with no tail gives. */
function temporariesOf(flow: FlowFunction): readonly ValueId[] {
  return flow.values.flatMap((value, id) =>
    value.kind === 'temporary' && value.site.kind !== 'Block' ? [id] : [],
  );
}

describe("a body's flow", () => {
  it("releases a block's variable once, at its end", () => {
    expect(releasesOf(subjectFlow('if c:\n  const t = "a"'), 't')).toEqual(['end']);
  });

  it('releases a loop pass variable where `break` and `continue` leave it, and at its end', () => {
    const flow = subjectFlow(
      [
        'for i in 0..3:',
        '  const t = "a"',
        '  if c:',
        '    break',
        '  if n > 1:',
        '    continue',
      ].join('\n'),
    );
    expect(releasesOf(flow, 't')).toEqual(['end', 'end', 'end']);
  });

  it("releases a `hold(name)`'s variable once, where the block it names ends", () => {
    const flow = subjectFlow(
      [
        'outer:',
        '  for i in 0..3:',
        '    hold(outer) const h = "a"',
        '    if c:',
        '      break',
      ].join('\n'),
    );
    expect(releasesOf(flow, 'h')).toEqual(['end']);
  });

  it("keeps a `hold(name)`'s variable over the passes of the loop it names, `continue` too", () => {
    const flow = subjectFlow(
      [
        'outer: for i in 0..3:',
        '  for j in 0..3:',
        '    hold(outer) const h = "a"',
        '    if c:',
        '      break outer',
        '    if n > 1:',
        '      continue outer',
      ].join('\n'),
    );
    expect(releasesOf(flow, 'h')).toEqual(['end']);
  });

  it('releases what a `hold(name)` keeps where an exit built before the `hold` leaves its scope', () => {
    const flow = subjectFlow(
      [
        'outer: for i in 0..3:',
        '  inner: for j in 0..3:',
        '    if c:',
        '      break outer',
        '    hold(inner) const h = "a"',
      ].join('\n'),
    );
    expect(releasesOf(flow, 'h')).toEqual(['end', 'end']);
  });

  it('releases what a `hold(name)` keeps before the scopes around it an exit leaves too', () => {
    const flow = subjectFlow(
      [
        'outer: for i in 0..3:',
        '  const x = "b"',
        '  inner: for j in 0..3:',
        '    if c:',
        '      break outer',
        '    hold(inner) const h = "a"',
      ].join('\n'),
    );
    const named = (values: readonly ValueId[]) =>
      values.flatMap((value) => {
        const found = flow.values[value];
        return found?.kind === 'variable' ? [found.entity.name.text] : [];
      });
    const inOrder = flow.blocks.map(({ operations }) =>
      operations.flatMap((operation) =>
        operation.op === 'release' ? named(operation.values) : [],
      ),
    );
    const hFirst = inOrder.filter((names) => names.includes('h') && names.includes('x'));
    // Where the inner loop ends, and where the `break` leaves both.
    expect(hFirst.map((names) => names.indexOf('h') < names.indexOf('x'))).toEqual([true, true]);
  });

  it("keeps what a `hold(name)` keeps where its variable's block ends", () => {
    const flow = subjectFlow(['outer:', '  if c:', '    hold(outer) const h = "a"'].join('\n'));
    const kept = operationsOf(flow, 'keep');
    expect(kept.map(({ values }) => values.map((value) => flow.values[value]?.kind))).toEqual([
      ['variable'],
    ]);
    expect(kept[0]?.until).toMatchObject({ kind: 'LabelledBlock' });
  });

  it('releases a dropped variable by its `drop`, and its function block by its return', () => {
    expect(releasesOf(subjectFlow('const t = "a"\ndrop t'), 't')).toEqual(['drop']);
  });

  it("holds each `select` case's temporaries in the case, which the scope around releases", () => {
    const flow = subjectFlow(
      [
        'if c:',
        '  const s = Slot.create<Int>()',
        '  select:',
        '    case s.read() as v:',
        '      v',
        '    else:',
        '      0',
      ].join('\n'),
    );
    const [test] = flow.blocks.flatMap(({ exit }) =>
      exit.kind === 'branch' && exit.test.kind === 'select' ? [exit.test] : [],
    );
    const [held] = test?.holds ?? [];
    expect(held?.length).toBeGreaterThan(0);
    const released = operationsOf(flow, 'release').filter(({ values }) =>
      held?.every((value) => values.includes(value)),
    );
    expect(released).toHaveLength(1);
  });

  it("releases each of a statement's temporaries once, at its end", () => {
    const flow = subjectFlow('const t = (1, 2)');
    const released = operationsOf(flow, 'release').flatMap(({ values }) => values);
    expect(released.toSorted()).toEqual(temporariesOf(flow));
  });

  it("releases a condition's temporaries on both of its paths, before the body on one", () => {
    const flow = subjectFlow('if n == 1:\n  const t = "a"');
    const releases = operationsOf(flow, 'release').map(({ values }) => values);
    const [condition] = releases.filter((values) => values.length > 1);
    expect(releases.filter((values) => values.join() === condition?.join())).toHaveLength(2);
  });
});
