/**
 * The code writer's labels: wherever a label is placed relative to the jumps naming it, every jump
 * ends up at its label's position, and code with a label jumped to but never placed is refused.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CodeWriter, type Label } from './code-writer.ts';

const span = { start: 0, end: 0 };

/**
 * One step of writing: a jump to label `n`, a switch to labels `ns` and maybe an `otherwise`, a
 * placement of label `n`, or a filler instruction.
 */
type Step =
  | { readonly kind: 'jump'; readonly label: number }
  | {
      readonly kind: 'switch';
      readonly labels: readonly number[];
      readonly otherwise: number | undefined;
    }
  | { readonly kind: 'place'; readonly label: number }
  | { readonly kind: 'filler' };

const labelCount = 4;

const neverPlaced = /never placed/u;

const steps = fc.array(
  fc.oneof(
    fc.record({ kind: fc.constant('jump' as const), label: fc.nat({ max: labelCount - 1 }) }),
    fc.record({
      kind: fc.constant('switch' as const),
      labels: fc.array(fc.nat({ max: labelCount - 1 }), { minLength: 1, maxLength: 3 }),
      otherwise: fc.option(fc.nat({ max: labelCount - 1 }), { nil: undefined }),
    }),
    fc.record({ kind: fc.constant('place' as const), label: fc.nat({ max: labelCount - 1 }) }),
    fc.constant({ kind: 'filler' as const }),
  ),
  { maxLength: 30 },
);

/** Writes `script`, then places every label not placed yet; where each label ended up. */
function write(script: readonly Step[]) {
  const code = new CodeWriter();
  const labels: Label[] = Array.from({ length: labelCount }, () => code.newLabel());
  const positions = new Map<number, number>();
  const jumps: { readonly at: number; readonly label: number }[] = [];
  const switches: {
    readonly at: number;
    readonly labels: readonly number[];
    readonly otherwise: number | undefined;
  }[] = [];
  let written = 0;
  const place = (label: number) => {
    const target = labels[label];
    if (target !== undefined && !positions.has(label)) {
      positions.set(label, written);
      code.place(target);
    }
  };
  for (const step of script) {
    if (step.kind === 'jump') {
      const target = labels[step.label];
      if (target !== undefined) {
        jumps.push({ at: written, label: step.label });
        code.jump(target, span);
        written += 1;
      }
    } else if (step.kind === 'switch') {
      switches.push({ at: written, labels: step.labels, otherwise: step.otherwise });
      const labelOf = (label: number) => labels[label] ?? code.newLabel();
      code.switch(
        code.allocate(),
        step.labels.map(labelOf),
        span,
        step.otherwise === undefined ? undefined : labelOf(step.otherwise),
      );
      written += 1;
    } else if (step.kind === 'place') {
      place(step.label);
    } else {
      code.emit({ kind: 'return', span, value: code.allocate() });
      written += 1;
    }
  }
  for (let label = 0; label < labelCount; label += 1) {
    place(label);
  }
  return { code: code.finish(), positions, jumps, switches };
}

describe('CodeWriter', () => {
  it('sends every jump to where its label was placed, before or after the jump', () => {
    fc.assert(
      fc.property(steps, (script) => {
        const { code, positions, jumps } = write(script);
        for (const { at, label } of jumps) {
          expect(code.instructions[at]).toMatchObject({
            kind: 'jump',
            target: positions.get(label),
          });
        }
      }),
    );
  });

  it("sends every switch target and its 'otherwise' to where its label was placed", () => {
    fc.assert(
      fc.property(steps, (script) => {
        const { code, positions, switches } = write(script);
        for (const { at, labels, otherwise } of switches) {
          expect(code.instructions[at]).toStrictEqual({
            kind: 'switch',
            span,
            value: expect.any(Number),
            targets: labels.map((label) => positions.get(label)),
            ...(otherwise === undefined ? {} : { otherwise: positions.get(otherwise) }),
          });
        }
      }),
    );
  });

  it('refuses code with a label jumped to but never placed', () => {
    const code = new CodeWriter();
    code.jump(code.newLabel(), span);
    expect(() => code.finish()).toThrow(neverPlaced);
  });
});
