# Lowering Findings (`src/compiler/lowering`)

### [high] Feature reduction: `AsyncFit` (`asyncFitEntry` / `asyncFitClosure` / `asyncFitIndex`) is a duplicate pipeline of `wrapping` `ConversionEntry` (`wrappingEntry`)

- where: `src/compiler/lowering/functions/fits/index.ts:55, 69-70, 81-84, 115-118, 191-200, 275-304, 351-378`, `src/compiler/lowering/tables/instances.ts:127-132, 221-223, 249-251`, `src/compiler/lowering/tables/tables.ts:89, 192-196, 300-302`, `src/compiler/lowering/lower.ts:33, 161-162`
- evidence:
  - When a plain function value `plain` (`fn(A) -> B`) is converted to an async function `to` (`async fn(A) -> Future<B>`) by `conversion.kind === 'async'`, `applyingIn` (`src/compiler/lowering/functions/fits/index.ts:191-200`) already lowers it through `wrappingEntry`:
    ```ts
    madeAsync: (value, plain, to) => {
      const entry = code.tables.conversionIndex({ kind: 'wrapping', from: plain, to, at });
      return closureOf(code, entry, [value], at.span);
    },
    ```
  - Meanwhile, `fittedValue` (`src/compiler/lowering/functions/fits/index.ts:81-84`) dispatches the exact same `conversion.kind === 'async'` to a separate `AsyncFit` pipeline (`asyncFitClosure` → `DefinitionTables.asyncFitIndex` → `PendingEntry` `'asyncFit'` → `lower.ts` → `asyncFitEntry` → `DefinitionTables.asyncFitHeader` → `asyncFitKey` / `asyncFitName`).
  - `asyncFitEntry` (`src/compiler/lowering/functions/fits/index.ts:360-378`) is the exact special case of `wrappingEntry` (`src/compiler/lowering/functions/fits/index.ts:275-304`) where `from` and `to` have identical parameter types (`fittedIn` is a no-op on each parameter) and `resultFitBetween(checker, from, to)` is `'resolved'` (`returnedAs` emits `code.return(called)` and returns `true`).
  - Furthermore, across the checker/lowering boundary, `conversion.kind === 'shape'` and `conversion.kind === 'async'` in `Fit['conversion']` (`src/compiler/checker/types/fitting/fit/index.ts:81-89`) are special cases of `conversion.kind === 'parts'`, forcing every consumer of `Fit['conversion']` (`src/compiler/checker/wiring/body/facts/instantiation.ts:298-303`, `src/compiler/checker/rules/computation/forms.ts:87-98`, `src/compiler/checker/rules/lifetimes/dispatch.ts:221`, `src/compiler/lowering/functions/fits/index.ts:115-143`) to handle them in parallel.
- proposal:
  - In lowering, replace `how.madeAsync` in `convertedValue` (`src/compiler/lowering/functions/fits/index.ts:115-118`) with `partsConverted` / `tables.conversionIndex({ kind: 'wrapping', from: functionTypeOf(typed.type), to, at: how.at })`. Delete `AsyncFit`, `asyncFitKey`, `asyncFitName` (`tables/instances.ts`), `asyncFitHeader`, `asyncFitIndex`, `PendingEntry` `'asyncFit'` (`tables/tables.ts`), `case 'asyncFit'` (`lower.ts`), and `Applying.madeAsync`, `FittingSite.owner`, `asyncFitClosure`, `asyncFitEntry` (`functions/fits/index.ts`).
  - Cross-area with checker (`chk`): fold `conversion.kind === 'shape'` into `conversion.kind === 'parts'` in `src/compiler/checker/types/fitting/fit/index.ts`.
- confidence: high

---

### [high] DRY & Double Standard: `fittedInto` (`values/keyed-fields.ts`), `returnedError` (`constructs/expressions/control/propagate.ts`), and `fitBetween` (`functions/fits/index.ts`) duplicate dynamic concrete fitting and `TypedValue` vs `TypedRegister`

- where: `src/compiler/lowering/values/keyed-fields.ts:74-86`, `src/compiler/lowering/constructs/expressions/control/propagate.ts:50-65`, `src/compiler/lowering/functions/fits/index.ts:50-53, 206-213, 223-228, 236-241`, `src/compiler/lowering/functions/fits/parts.ts:78`, `src/compiler/lowering/values/holdings.ts:32-35`
- evidence:
  - The banner of `src/compiler/lowering/values/keyed-fields.ts:10-12` explicitly notes the duplication: *"how it converts is derived here from the types the instantiation made concrete, as a `?`'s error is (constructs/expressions/control/propagate.ts), so a key the instantiation left one name converts by the same rule (`fittedInto`)."*
  - `fittedInto` (`src/compiler/lowering/values/keyed-fields.ts:74-86`):
    ```ts
    export function fittedInto(
      context: FunctionContext,
      value: TypedValue,
      type: Type,
      site: Expression,
    ): Register {
      const fit =
        context.checker.fitOf(value.type, type) ??
        unreachable(`A write at ${site.span.from} doesn't fit its field; the checker should have said so.`);
      return context.fitted(value.register, value.type, fit, site);
    }
    ```
  - `returnedError` (`src/compiler/lowering/constructs/expressions/control/propagate.ts:50-65`):
    ```ts
    function returnedError(
      context: FunctionContext,
      error: { readonly register: Register; readonly type: Type; readonly returned: Type; readonly site: Propagate },
    ): Register {
      const fit =
        context.checker.fitOf(error.type, error.returned) ??
        unreachable(`'?' at ${error.site.span.from} passes an error that doesn't fit; the checker should have said so.`);
      return context.fitted(error.register, error.type, fit, error.site);
    }
    ```
  - `fitBetween` (`src/compiler/lowering/functions/fits/index.ts:236-241`) and `changesLayout` (`src/compiler/lowering/functions/fits/parts.ts:78`) repeat the same `checker.fitOf(from, to) ?? unreachable(...)` lookup.
  - `TypedRegister` (`{ readonly value: Register; readonly type: Type }` in `src/compiler/lowering/functions/fits/index.ts:50-53`) and `TypedValue` (`{ readonly register: Register; readonly type: Type }` in `src/compiler/lowering/values/holdings.ts:32-35`, plus `ValueOf<Kind>` in `src/compiler/lowering/functions/fits/parts.ts:159-162` and `UnionValue` in `src/compiler/lowering/values/unions.ts:46-49`) are rival shapes for the same concept, forcing `rebuildingIn` (`src/compiler/lowering/functions/fits/index.ts:225`) to convert `{ value: part.register, type: part.type }`.
- proposal:
  - Standardize on `TypedValue<T extends Type = Type> { readonly register: Register; readonly type: T }` (`src/compiler/lowering/values/holdings.ts`), deleting `TypedRegister`, `ValueOf`, and `UnionValue` (`TypedValue<UnionType>`).
  - Export `fitBetween` and `fittedInto(context: FunctionContext, value: TypedValue, to: Type, site: ValueSite): Register` from `src/compiler/lowering/functions/fits/index.ts` (or put `fittedInto` on `FunctionContext`), and call it from `propagate.ts` (deleting `returnedError`), `places.ts`, and `keyed-fields.ts` (deleting its `fittedInto`).
- confidence: high

---

### [high] DRY: `wrappingEntry` (`functions/fits/index.ts`) and `dispatchEntry` (`synthesized/trait-objects.ts`) duplicate parameter conversion and result awaiting/conversion (`returnedAs` vs `convertedResult`)

- where: `src/compiler/lowering/functions/fits/index.ts:287-295, 312-326`, `src/compiler/lowering/synthesized/trait-objects.ts:89-102, 115-126`
- evidence:
  - Parameter conversion in `wrappingEntry` (`src/compiler/lowering/functions/fits/index.ts:287-295`):
    ```ts
    const passed = code.parameters.map((parameter, index) => {
      const taken = to.parameters[index];
      const own = from.parameters[index];
      if (taken === undefined || own === undefined || taken.reference) {
        return code.passedOn(index, references);
      }
      const register = fittedIn(code, { value: parameter, type: taken.type }, own.type, at);
      return { kind: 'value' as const, register };
    });
    ```
  - Parameter conversion in `dispatchEntry` (`src/compiler/lowering/synthesized/trait-objects.ts:89-97`):
    ```ts
    const passed = code.parameters.slice(1).map((value, index) => {
      const called = signatures?.called.parameters[index + 1];
      const met = signatures?.met.parameters[index + 1];
      if (called === undefined || met === undefined || called.reference) {
        return code.passedOn(index + 1, references);
      }
      const register = fittedIn(code, { value, type: called.type }, met.type, at);
      return { kind: 'value' as const, register };
    });
    ```
  - Result conversion in `dispatchEntry` (`src/compiler/lowering/synthesized/trait-objects.ts:100-102, 115-126`) defines a private `convertedResult` that calls `resultFitBetween(code.checker, met, called)` and branches on `fit.kind === 'value'` to call `fittedIn` — duplicating `returnedAs` (`src/compiler/lowering/functions/fits/index.ts:312-326`), which already calls `resultFitBetween`, awaits `called` when `result.kind === 'awaited'`, fits the result with `fittedIn`, and emits `code.return(...)`.
- proposal:
  - Extract `fittedArguments(code: SynthesizedCode, signatures: { readonly from: FunctionType; readonly to: FunctionType } | undefined, references: readonly boolean[], at: ConversionSite, start = 0): readonly Argument[]` in `src/compiler/lowering/functions/fits/index.ts` and call it from both `wrappingEntry` and `dispatchEntry`.
  - In `dispatchEntry`, call `returnedAs(code, call, { from: signatures.met, to: signatures.called }, at)` when `signatures !== undefined`, and delete `convertedResult` from `src/compiler/lowering/synthesized/trait-objects.ts`.
- confidence: high

---

### [high] Generalization & DRY: `rebuiltStruct` (`functions/fits/parts.ts`) is a special case of `rebuiltAs` (`values/struct-values.ts`), and `part-paths.ts` / `keyed-fields.ts` re-implement `structFieldOf`

- where: `src/compiler/lowering/values/struct-values.ts:61-79`, `src/compiler/lowering/functions/fits/parts.ts:185-202`, `src/compiler/lowering/constructs/parts/part-paths.ts:88-92`, `src/compiler/lowering/values/keyed-fields.ts:126-135`, `src/compiler/checker/surface/checked-field.ts:95-109`
- evidence:
  - `rebuiltAs` (`src/compiler/lowering/values/struct-values.ts:61-79`) reads each field of `to` by name from `value` (of type `from`) and calls `construct(context, to, named, span)`.
  - `rebuiltStruct` (`src/compiler/lowering/functions/fits/parts.ts:185-202`) does the same field-by-field read from `{ register, type }` to construct `to: StructValueType`, applying `how.converted(part, target)` to each read field.
  - Meanwhile, `positionsOf` (`src/compiler/lowering/constructs/parts/part-paths.ts:88-92`) and `eachKeyedField` (`src/compiler/lowering/values/keyed-fields.ts:126-135`) both manually run `(context.checker.fieldsOf(...) ?? []).findIndex((field) => field.name === ...)` instead of using `structFieldOf` from `src/compiler/checker/surface/checked-field.ts:95-109`.
- proposal:
  - Add an optional `convert: (part: TypedValue, target: Type) => Register = (part) => part.register` parameter to `rebuiltAs` in `src/compiler/lowering/values/struct-values.ts`, and replace `rebuiltStruct` in `src/compiler/lowering/functions/fits/parts.ts` with `rebuiltAs`.
  - Use `structFieldOf` (`src/compiler/checker/surface/checked-field.ts`) in `part-paths.ts` and `keyed-fields.ts`.
- confidence: high

---

### [med] DRY & SRP: Frame cell tracking (`#cells: CellRegister[]`) and `cellRegister` are duplicated across `VariableRegisters`, `SynthesizedCode`, and `places.ts`

- where: `src/compiler/lowering/constructs/statements/variables.ts:75, 153-159`, `src/compiler/lowering/constructs/parts/places.ts:132-136, 152-156, 375-377`, `src/compiler/lowering/synthesized/index.ts:49, 127-132, 169`, `src/compiler/lowering/functions/index.ts:415`
- evidence:
  - `VariableRegisters` (`src/compiler/lowering/constructs/statements/variables.ts:75, 153-159`) stores `readonly #cells: CellRegister[] = []` with `addCell` and `get cells`, even though `VariableRegisters` never reads `#cells` for scope or variable management; only `FunctionLowering.#entry` (`src/compiler/lowering/functions/index.ts:415`) reads `this.variables.cells` to populate `CodeFunction.cells`.
  - Because `cellRegister` (`src/compiler/lowering/constructs/parts/places.ts:152-156`) takes `FunctionContext` to reach `context.variables.addCell`, `SynthesizedCode` (`src/compiler/lowering/synthesized/index.ts:49, 127-132, 169`) has to maintain a second `readonly #cells: CellRegister[] = []` and re-implement cell allocation, `this.tables.types.index(this.checker.cellOf(type))` (`cellTypeIndex` in `places.ts:375-377`), and `{ kind: 'reference', place: { register, path: [] } }` (which also re-implements `referenceTo(register)` from `src/compiler/lowering/calls/emit-call.ts:207-209`).
- proposal:
  - Move `#cells: CellRegister[]` onto `CodeWriter` (`src/compiler/lowering/functions/code-writer.ts`), returned by `CodeWriter.finish(tree)`.
  - Change `cellRegister(context: CodeContext, type: Type): Register` to take `CodeContext`, and have `SynthesizedCode.inCell(value, type)` call `cellRegister(this, type)` and `referenceTo(register)`, removing `#cells` from both `VariableRegisters` and `SynthesizedCode`.
- confidence: high

---

### [med] DRY: Host native entries (`hostNativeEntry` vs `constantNativeEntry`) and table methods (`hostNativeIndex` vs `constantNativeIndex`) are split into parallel pipelines

- where: `src/compiler/lowering/synthesized/boundary/host-externs.ts:83-137, 152-174`, `src/compiler/lowering/tables/tables.ts:76-86, 324-345`, `src/compiler/lowering/lower.ts:141-146`, `src/compiler/lowering/constructs/expressions/access/names.ts:65-68`
- evidence:
  - `hostNativeIndex` and `constantNativeIndex` (`src/compiler/lowering/tables/tables.ts:324-333`) even compute the exact same interning key: ``const key = `native:${this.#checker.typeKeys.identityOf(declaration)}`;``.
  - `hostNativeEntry` and `constantNativeEntry` (`src/compiler/lowering/synthesized/boundary/host-externs.ts:104-137`) both call `nativeParts(lowering, declaration)` and build the same `ExternFunction` object, differing only in whether `declaration` is a `FunctionDeclaration` (has parameters and optional `awaitedOf`) or an `ExternConstantDeclaration` (`parameters: []`, `constant: true`).
  - `hostConstantEntry` (`src/compiler/lowering/synthesized/boundary/host-externs.ts:83-98`) manually emits `code.call(native, [])` + `inboundOf(checker, undefined, type, { from: 'result', path: header.name })` + `emitInbound(code, native, inbound, code.span)`, which is the exact 0-parameter, non-awaited case of `writeHostCall` (`src/compiler/lowering/synthesized/boundary/host-externs.ts:180-200`) in the same file.
- proposal:
  - Unify `hostNativeEntry` and `constantNativeEntry` into a single `hostNativeEntry(lowering: Lowering, declaration: HostExternDeclaration, type?: Type): FunctionDefinition`, and unify `hostNativeIndex` and `constantNativeIndex` on `DefinitionTables` into one `hostNativeIndex` and one `'hostNative'` `PendingEntry` variant.
  - Have `hostConstantEntry` delegate its body to `writeHostCall`.
- confidence: high

---

### [med] DRY: `FunctionLowering.lower`, `FunctionLowering.lowerNested`, `bodyEntry` (`lower.ts`), and `startEntry` (`starts.ts`) duplicate body lookup and entry lowering

- where: `src/compiler/lowering/functions/index.ts:235-239, 278-319`, `src/compiler/lowering/lower.ts:205-214, 239-245`, `src/compiler/lowering/synthesized/boundary/starts.ts:173-190`
- evidence:
  - `FunctionLowering` (`src/compiler/lowering/functions/index.ts`) already holds `this.frame.function` (`FunctionDeclaration | Lambda | ContextConstantDeclaration`), `this.checker.program`, and `this.module`.
  - Yet `FunctionLowering.lower(block: Block)` (`functions/index.ts:235-239`) requires its caller (`bodyEntry` in `lower.ts:205-214`) to look up `writtenBodyOf(checker.program, checker.moduleOf(declaration), declaration)` and check `body === undefined`, whereas `FunctionLowering.lowerNested(node)` (`functions/index.ts:278-288`) looks up `writtenBodyOf(this.checker.program, this.module, node)` itself!
  - `startEntry` (`src/compiler/lowering/synthesized/boundary/starts.ts:173-190`) also repeats `writtenBodyOf(checker.program, checker.moduleOf(target), target)` and passes `body` into `lowerStart(edges, body)`.
  - Aside from how `block` is passed in, `FunctionLowering.lower(block)` and `FunctionLowering.lowerNested(node)` are identical: both call `declareFrame(this, this.#slots())`, lower the body (`lowerBody` for a `Block`, `this.expression` for a lambda expression), emit `return`, and return `this.#entry(parameters)`.
- proposal:
  - Add a private `#writtenBody(): Block | Expression` method on `FunctionLowering` that resolves `this.frame.function`'s body via `writtenBodyOf`.
  - Merge `lower(block)` and `lowerNested(node)` into a single parameterless `lower(): CodeFunction` method on `FunctionLowering`, and remove the `body` parameter from `lowerStart(edges: StartEdges): CodeFunction`.
  - Keep `writtenBodyOf` internal to `src/compiler/lowering/functions/`.
- confidence: high

---

### [med] DRY: Five sites emit `closure` instructions with three local `closure` / `closureOf` / `asyncFitClosure` helpers

- where: `src/compiler/lowering/constructs/expressions/closures.ts:41-74`, `src/compiler/lowering/constructs/expressions/deferred-calls.ts:115-124`, `src/compiler/lowering/functions/fits/index.ts:176-185, 351-357`
- evidence:
  - `closure` in `src/compiler/lowering/constructs/expressions/deferred-calls.ts:115-124`:
    ```ts
    function closure(
      context: CodeContext,
      entry: number,
      values: readonly Register[],
      span: AnchoredSpan,
    ): Register {
      const dst = context.code.allocate();
      context.code.emit({ kind: 'closure', span, dst, function: entry, captures: [...values] });
      return dst;
    }
    ```
  - `closureOf` in `src/compiler/lowering/functions/fits/index.ts:176-185` is character-for-character identical:
    ```ts
    function closureOf(
      context: CodeContext,
      entry: FunctionId,
      captures: readonly Register[],
      span: AnchoredSpan,
    ): Register {
      const dst = context.code.allocate();
      context.code.emit({ kind: 'closure', span, dst, function: entry, captures: [...captures] });
      return dst;
    }
    ```
  - In the very same file `src/compiler/lowering/functions/fits/index.ts:351-357`, `asyncFitClosure` hand-rolls `allocate()` + `emit({ kind: 'closure', ... })` instead of calling `closureOf`.
  - `lowerFunctionValue` and `closureOf` in `src/compiler/lowering/constructs/expressions/closures.ts:41-74` also emit `{ kind: 'closure', ... }` directly.
- proposal:
  - Add `closure(entry: FunctionId, captures: readonly Register[], span: AnchoredSpan, dst = this.allocate()): Register` to `CodeWriter` (`src/compiler/lowering/functions/code-writer.ts`), and use it in `closures.ts`, `deferred-calls.ts`, and `fits/index.ts`, deleting the local helpers.
- confidence: high

---

### [med] DRY: Six sites repeat `substitute(checker.resultOf(instance.declaration), substitutionOf(instance), checker.typeRules)`

- where: `src/compiler/lowering/calls/closed-calls.ts:95-99`, `src/compiler/lowering/functions/frames.ts:199`, `src/compiler/lowering/lower.ts:231-233`, `src/compiler/lowering/synthesized/boundary/codecs.ts:54-58`, `src/compiler/lowering/synthesized/boundary/host-externs.ts:76`, `src/compiler/lowering/values/variant-values.ts:75-79`
- evidence:
  - Every one of those 6 sites computes the substituted return type of a `FunctionInstance`:
    `substitute(checker.resultOf(instance.declaration), substitutionOf(instance), checker.typeRules)`.
- proposal:
  - Export `instanceResult(checker: Pick<Checker, 'resultOf' | 'typeRules'>, instance: FunctionInstance): Type` from `src/compiler/lowering/tables/instances.ts` (or `src/compiler/lowering/calls/closed-calls.ts`) and use it at all 6 call sites.
- confidence: high

---

### [med] DRY: Five files repeat `const { scope } = context.variables.inBlock(() => { ... }); endScope(context, scope, span);`

- where: `src/compiler/lowering/constructs/expressions/control/matching.ts:46-50`, `src/compiler/lowering/constructs/expressions/control/select.ts:56-60`, `src/compiler/lowering/constructs/loops/field-passes.ts:55-59`, `src/compiler/lowering/constructs/loops/iteration.ts:77-81`, `src/compiler/lowering/constructs/statements/holds.ts:60-65`, `src/compiler/lowering/constructs/statements/scopes.ts:18-58`
- evidence:
  - `src/compiler/lowering/constructs/statements/scopes.ts` provides `valueInBlock(context, span, lower: () => Register): Register` for blocks that produce a value, but no counterpart for `void` blocks.
  - As a result, `matching.ts`, `select.ts`, `field-passes.ts`, `iteration.ts`, and `holds.ts` each import `endScope` and write:
    ```ts
    const { scope } = context.variables.inBlock(() => {
      ...
    });
    endScope(context, scope, span);
    ```
- proposal:
  - Export `inScope(context: FunctionContext, span: AnchoredSpan, lower: () => void): void` from `src/compiler/lowering/constructs/statements/scopes.ts` and use it in `matching.ts`, `select.ts`, `field-passes.ts`, `iteration.ts`, and `holds.ts`.
- confidence: high

---

### [med] DRY: `Decoder` and `Encoder` duplicate field-codec resolution and `checker.json.callOf` closing

- where: `src/compiler/lowering/synthesized/boundary/codec-calls.ts:21-42`, `src/compiler/lowering/synthesized/boundary/decoder.ts:47, 177-180, 193-196`, `src/compiler/lowering/synthesized/boundary/encoder.ts:47-48, 130-133`, `src/compiler/lowering/synthesized/boundary/inbound.ts:55`
- evidence:
  - `Decoder.#field` (`src/compiler/lowering/synthesized/boundary/decoder.ts:177-180`) and `Encoder.#object` (`src/compiler/lowering/synthesized/boundary/encoder.ts:130-133`) both resolve a `JsonField`'s codec in their direction with the same ternary:
    ```ts
    const decode =
      field.codec === undefined
        ? this.#codec(field.type)
        : closeCall(field.codec.read, undefined, code.checker);
    ```
    and
    ```ts
    const encode =
      field.codec === undefined
        ? this.#codec(field.type)
        : closeCall(field.codec.write, undefined, code.checker);
    ```
  - `Decoder.#helper` (`decoder.ts:193-196`), `Encoder.write` (`encoder.ts:47-48`, which doesn't even have a `#helper` method and inlines `closeCall(code.checker.json.callOf(...), undefined, code.checker)`), and `inboundOf` (`inbound.ts:55`) all close a `checker.json.callOf(helper, typeArguments)` call.
- proposal:
  - Export `fieldCodecCall(checker: Checker, field: JsonField, direction: JsonDirection): ClosedCall` and `codecHelperCall(checker: Checker, helper: CodecHelper, typeArguments?: readonly Type[], within?: FunctionInstance): ClosedCall` from `src/compiler/lowering/synthesized/boundary/codec-calls.ts`, and use them in `Decoder`, `Encoder`, and `inboundOf`.
- confidence: high

---

### [med] DRY & Generalization: `TypeTable.#typeEntry`, `TypeTable.#aliasEntry`, and `TypeTable.anyIndex` duplicate slot-reservation interning

- where: `src/compiler/lowering/tables/type-table.ts:213-223, 254-285`
- evidence:
  - `#typeEntry` (`src/compiler/lowering/tables/type-table.ts:254-265`) and `#aliasEntry` (`src/compiler/lowering/tables/type-table.ts:268-285`) repeat the exact same 9-line slot-reservation pattern before computing the entry so recursive types can refer to their own `TypeId`:
    ```ts
    const key = this.#checker.typeKeys.typeKey(type);
    const known = this.#indexes.get(key);
    if (known !== undefined) {
      return known;
    }
    const index = this.#entries.length;
    this.#indexes.set(key, index);
    this.#entries.push({ kind: 'struct', name: '', arguments: [], fields: [] });
    this.#entries[index] = ...;
    return index;
    ```
  - `anyIndex` (`src/compiler/lowering/tables/type-table.ts:213-223`) also interns by `this.#checker.typeKeys.typeKey(type)` into `this.#indexes` and `this.#entries`.
- proposal:
  - Extract `#interned(type: Type, build: () => TypeDefinition | AnyEntry): TypeId` on `TypeTable` (analogous to `DefinitionTables.#numbered` in `src/compiler/lowering/tables/tables.ts:399-405`) and use it in `anyIndex`, `#typeEntry`, and `#aliasEntry`.
- confidence: high

---

### [med] DRY & Generalization: `branchOnVariant` (`variants.ts`) and `branchOnAnyVariants` (`holdings.ts`) duplicate variant-index `switch` emission

- where: `src/compiler/lowering/constructs/expressions/structs/variants.ts:58-68`, `src/compiler/lowering/values/holdings.ts:141-144, 202-221`, `src/compiler/lowering/constructs/parts/patterns.ts:118-122`
- evidence:
  - `branchOnVariant` (`src/compiler/lowering/constructs/expressions/structs/variants.ts:58-68`):
    ```ts
    const targets = Array.from({ length: test.variant + 1 }, (_, index) =>
      index === test.variant ? labels.matched : labels.otherwise,
    );
    context.code.switch(test.register, targets, span, labels.otherwise);
    ```
  - `branchOnAnyVariants` (`src/compiler/lowering/values/holdings.ts:202-221`):
    ```ts
    const variants = new Set(
      members.map((member) => context.tables.types.anyVariant(value.type, baseOf(member))),
    );
    const targets = Array.from({ length: Math.max(...variants) + 1 }, (_, index) =>
      variants.has(index) ? matched : otherwise,
    );
    context.code.switch(value.register, targets, span, otherwise);
    ```
  - `branchOnVariant` is the single-variant case of `branchOnVariants`. Both files plus `patterns.ts` also define identical `Branch { readonly matched: Label; readonly otherwise: Label }` shapes.
- proposal:
  - Generalize `branchOnVariant` (or add `CodeWriter.switchOnVariants(value: Register, variants: ReadonlySet<number>, { matched, otherwise }: Branch, span: AnchoredSpan)`) so both `branchOnVariant` and `branchOnAnyVariants` call it.
- confidence: high

---

### [low] Dead code & wrapper cleanup: unused `Startable.isAsync`, constant-parameter `emitVariant`, and 1-line forwarding wrappers (`lowerStructLiteral`/`lowerNewStructLiteral`, `lowerName`, `nestedEntryOf`, `variantOf`)

- where:
  - `src/compiler/lowering/synthesized/boundary/starts.ts:49, 91, 125`
  - `src/compiler/lowering/constructs/expressions/structs/variants.ts:20-26, 108-119`
  - `src/compiler/lowering/constructs/expressions/structs/structs.ts:35-41`, `src/compiler/lowering/constructs/expressions/expressions.ts:56-57`
  - `src/compiler/lowering/constructs/expressions/access/names.ts:25-27, 43-47`
  - `src/compiler/lowering/lower.ts:140, 239-245`
  - `src/compiler/lowering/values/holdings.ts:137-139, 253`
- evidence:
  - `Startable.isAsync` (`src/compiler/lowering/synthesized/boundary/starts.ts:49`) is populated in `functionStartable` (line 91) and `lambdaStartable` (line 125) and never read anywhere in the codebase.
  - `emitVariant(context, node, name, fields)` (`src/compiler/lowering/constructs/expressions/structs/variants.ts:108-119`) is a file-private function with a single caller (`lowerFieldlessVariant`, line 25), which always passes `fields = []`; its doc comment on line 20 also has a stale reference to `none` (which is lowered by `noneOf` in `values/optionals.ts`).
  - `lowerStructLiteral` and `lowerNewStructLiteral` (`src/compiler/lowering/constructs/expressions/structs/structs.ts:35-41`) both forward directly to `literalValue(context, node: FieldsLiteral)` (unlike `Break` and `Continue` in `statements.ts:45-46`, which share `lowerLoopExit`).
  - `lowerName(context, node)` (`src/compiler/lowering/constructs/expressions/access/names.ts:25-27`) forwards to `lowerNamed(context, node, node)`, which can default `read: Identifier | MemberAccess = name`.
  - `nestedEntryOf(checker, tables, nested)` (`src/compiler/lowering/lower.ts:239-245`) is a 1-line wrapper called once at `lower.ts:140` where `lowering = { checker, tables }` is already in scope.
  - `variantOf` (`src/compiler/lowering/values/holdings.ts:137-139`) is a 1-line wrapper around `context.tables.types.unionVariant(union, member)` called once at line 253.
- proposal:
  - Remove `isAsync` from `Startable`; inline `emitVariant` into `lowerFieldlessVariant`; export `lowerFieldsLiteral` in place of `lowerStructLiteral`/`lowerNewStructLiteral`; default `read = name` in `lowerNamed` and delete `lowerName`; inline `nestedEntryOf` in `lower.ts` and `variantOf` in `holdings.ts`.
- confidence: high

---

### [low] Double standard: `lowerFieldComprehension` (`comprehensions.ts`) emits `N + 1` runtime array-spread instructions instead of 1 `array` instruction like `comprehendedFields` (`structs.ts`)

- where: `src/compiler/lowering/constructs/expressions/collections/comprehensions.ts:31-45`, `src/compiler/lowering/constructs/expressions/structs/structs.ts:118-127`
- evidence:
  - Both `StructComprehension` and `FieldComprehension` unroll their passes at compile time over `visited.fields` (`fieldsVisited(context, node.header, span)`), with no runtime loop or filter condition.
  - `comprehendedFields` (`src/compiler/lowering/constructs/expressions/structs/structs.ts:118-127`) evaluates each field's pass with `valueInFieldScope(context, visited, position, () => context.expression(node.value))` and builds the struct in a single instruction.
  - `lowerFieldComprehension` (`src/compiler/lowering/constructs/expressions/collections/comprehensions.ts:31-45`) instead emits an empty `array` instruction and then calls `appendElement` (`[{ kind: 'spread', value: result }, { kind: 'item', value }]`) in each pass, emitting `N + 1` runtime array allocations/copies for `N` statically known fields.
- proposal:
  - In `lowerFieldComprehension`, map `visited.fields` with `valueInFieldScope(context, visited, position, () => ({ kind: 'item' as const, value: context.expression(node.body) }))` and emit a single `{ kind: 'array', span, dst: result, elements }` instruction.
- confidence: high

---

### [low] Dead exports: 31 exported interfaces/types in `src/compiler/lowering` have zero imports outside their own file

- where:
  - `src/compiler/lowering/calls/closed-calls.ts:127` (`ClosedFunctionCall`)
  - `src/compiler/lowering/calls/emit-call.ts:39, 67` (`CallToEmit`, `FunctionCallToEmit`)
  - `src/compiler/lowering/constructs/expressions/calls.ts:68, 151` (`PreparedCall`, `PassedArgument`)
  - `src/compiler/lowering/constructs/expressions/structs/variants.ts:42, 76` (`VariantTest`, `VariantCase`)
  - `src/compiler/lowering/constructs/loops/field-passes.ts:22` (`VisitedFields`)
  - `src/compiler/lowering/constructs/parts/patterns.ts:47` (`Matching`)
  - `src/compiler/lowering/constructs/parts/places.ts:116` (`ReferencedPlace`)
  - `src/compiler/lowering/constructs/statements/scopes.ts:76` (`Guarded`)
  - `src/compiler/lowering/constructs/statements/variables.ts:48, 51` (`Lifetime`, `Kept`)
  - `src/compiler/lowering/functions/code-writer.ts:41` (`WrittenCode`)
  - `src/compiler/lowering/functions/fits/index.ts:50` (`TypedRegister`)
  - `src/compiler/lowering/functions/frames.ts:50` (`LoweredFunction`)
  - `src/compiler/lowering/lower.ts:68` (`Suite`)
  - `src/compiler/lowering/synthesized/boundary/codecs.ts:25` (`CodecLowering`)
  - `src/compiler/lowering/synthesized/boundary/host-externs.ts:54` (`HostCall`)
  - `src/compiler/lowering/synthesized/boundary/inbound.ts:34, 37` (`InboundSource`, `Inbound`)
  - `src/compiler/lowering/synthesized/boundary/starts.ts:45` (`Startable`)
  - `src/compiler/lowering/synthesized/index.ts:43` (`Callee`)
  - `src/compiler/lowering/tables/own-entries.ts:22` (`OwnEntry`)
  - `src/compiler/lowering/tables/type-table.ts:67` (`TypeTableSeams`)
  - `src/compiler/lowering/values/holdings.ts:43, 82` (`Holding`, `HeldValue`)
  - `src/compiler/lowering/values/optionals.ts:46` (`OptionalRead`)
  - `src/compiler/lowering/values/unions.ts:46` (`UnionValue`)
  - `src/compiler/lowering/values/variant-values.ts:23, 57` (`VariantValue`, `ConstructorCall`)
- evidence:
  - None of these 31 `export interface` / `export type` declarations is imported by any other file (production or test) in the repository.
- proposal:
  - Drop the `export` keyword from interfaces/types that are only used as parameter/return annotations within their own module (or keep only those intentionally documenting a public module contract).
- confidence: high

---

## Missing from `docs/reuse`

### Stale or inaccurate entries in `docs/reuse/lowering-and-ir.md`
- `presentOrJump` (`src/compiler/lowering/values/optionals.ts:73`): listed in `docs/reuse/lowering-and-ir.md` (*"build `none` or put a value into `T?`, or read a `T?` where it isn't `none` → `noneOf`, `someOf`, `presentOrJump`, `presentOr` (`src/compiler/lowering/values/optionals.ts`)"*), but `presentOrJump` is not exported.
- `accessorLowering` (`src/compiler/lowering/functions/index.ts:147`) and `accessorFrame` (`src/compiler/lowering/functions/frames.ts:208`): `accessorLowering` is mentioned in `## One-way rules` of `docs/reuse/lowering-and-ir.md`, but both `accessorLowering` and `accessorFrame` are omitted from the `## Units` bullets for `functions/index.ts` and `functions/frames.ts`.

### Exported reusable units in `src/compiler/lowering` (with callers outside their folder) missing from `docs/reuse/lowering-and-ir.md`
- `ClosedCall`, `calledParameters` (`src/compiler/lowering/calls/closed-calls.ts`)
- `packElements`, `packElementsOf` (`src/compiler/lowering/calls/packs.ts`)
- `WaitCase` (`src/compiler/lowering/calls/waits.ts`)
- `CodeContext`, `FunctionContext` (`src/compiler/lowering/context.ts`)
- `writtenBodyOf`, `nestedSpanOf` (`src/compiler/lowering/functions/bodies.ts`)
- `Label`, `SelectCaseCode` (`src/compiler/lowering/functions/code-writer.ts`)
- `convertingEntry`, `wrappingEntry` (`src/compiler/lowering/functions/fits/index.ts`)
- `accessorLowering`, `StartEdges` (`src/compiler/lowering/functions/index.ts`)
- `hostCallOf`, `writeHostCall`, `hostConstantEntry`, `hostNativeEntry`, `constantNativeEntry` (`src/compiler/lowering/synthesized/boundary/host-externs.ts`)
- `startables`, `startableOf`, `listStart`, `startEntry` (`src/compiler/lowering/synthesized/boundary/starts.ts`)
- `anyConversionEntry`, `anyFieldEntry` (`src/compiler/lowering/synthesized/trait-objects.ts`)
- `ownerInstance`, `ownerDeclaration`, `ownerSubstitution`, `conversionName`, `NestedInstance`, `DeferredFunction`, `DeferredPlan`, `AsyncFit`, `ConversionSite`, `FieldPassStep` (`src/compiler/lowering/tables/instances.ts`)
- `PendingEntry`, `ClosingEntry`, `EntryHeader`, `HostExternDeclaration`, `StartTarget` (`src/compiler/lowering/tables/tables.ts`)
- `TypedValue` (`src/compiler/lowering/values/holdings.ts`)
- `OptionalChains` (`src/compiler/lowering/values/optionals.ts`)
- `structValue` (`src/compiler/lowering/values/struct-values.ts`)
- `literalValue` (`src/compiler/lowering/values/unions.ts`)
- `variantIndexOf` (`src/compiler/lowering/values/variant-values.ts`)
- `ordered` (`src/compiler/lowering/constructs/expressions/operators.ts`)
- `readsField`, `lowerFieldRead`, `lowerBareStruct` (`src/compiler/lowering/constructs/expressions/structs/structs.ts`)
- `lowerFieldlessVariant`, `fieldlessVariantCalled` (`src/compiler/lowering/constructs/expressions/structs/variants.ts`)
- `spreadArray` (`src/compiler/lowering/constructs/expressions/collections/collections.ts`)
- `lowerFunctionValue`, `lowerLocalFunction` (`src/compiler/lowering/constructs/expressions/closures.ts`)
- `iterationFormOf` (`src/compiler/lowering/constructs/loops/iteration.ts`)
- `neverLowered` (`src/compiler/lowering/constructs/never-lowered.ts`)
- `HoldScopes` (`src/compiler/lowering/constructs/statements/holds.ts`)
- `LoopStack`, `LoopTargets` (`src/compiler/lowering/constructs/statements/loops.ts`)
- `lowerStatement`, `lowerBlock`, `lowerBody` (`src/compiler/lowering/constructs/statements/statements.ts`)
- `declareVariable`, `VariableRegisters`, `CellRegister` (`src/compiler/lowering/constructs/statements/variables.ts`)
