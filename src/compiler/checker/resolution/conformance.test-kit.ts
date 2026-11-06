/**
 * The form builder's node trait and its wrappers, as conformance tests write them: every wrapper
 * meets `FormNode` through the same constraint on what it wraps, so a model nested in wrappers asks
 * the same goals again at each level (examples/FormBuilder).
 */

export const formNodeLibrary = [
  'trait FormNode { type Data, type Seen, fn seen(self: Self) -> Self.Seen, fn read(self: Self) -> Result<Self.Data>, fn load(self: Self, v: Self.Seen) }',
  'shared struct Field<T> { value: T? = none, type Data = T, type Seen = T? }',
  'fn seen<T>(self: Field<T>) -> T?: self->value',
  'fn read<T>(self: Field<T>) -> Result<T>:',
  '  match self->value:',
  '    case None: Err{Error{message: "unanswered", code: "unanswered"}}',
  '    case v: Ok{(v)}',
  'fn load<T>(self: Field<T>, v: T?): self->value = v',
  'struct ListRow<R is FormNode> { key: String, node: R }',
  'shared struct List<R is FormNode> { rows: Array<ListRow<R>> = [], make: fn() -> R, count: Int = 0, type Data = Array<R.Data>, type Seen = Array<R.Seen> }',
  'fn seen<R is FormNode>(self: List<R>) -> Array<R.Seen>: [for row in self->rows: row.node.seen()]',
  'fn read<R is FormNode>(self: List<R>) -> Result<Array<R.Data>>:',
  '  let out: Array<R.Data> = []',
  '  for row in self->rows: out.push(row.node.read()?)',
  '  Ok{(out)}',
  'fn load<R is FormNode>(self: List<R>, v: Array<R.Seen>):',
  '  self->rows = []',
  '  for x in v: { self->count += 1; const row = ListRow{key: `r${self->count}`, node: self->make()}; row.node.load(x); self->rows.push(row) }',
  'struct Group<S is struct { [_] is FormNode }>:',
  '  fields: S',
  '  type Data = match S:',
  '    case _: { [F in keyof S]: S[F].Data }',
  '  type Seen = match S:',
  '    case _: { [F in keyof S]: S[F].Seen }',
  'fn seen<S is struct { [_] is FormNode }>(self: Group<S>) -> Group<S>.Seen: struct{for f, node in ...self.fields: [f]: node.seen()}',
  'fn read<S is struct { [_] is FormNode }>(self: Group<S>) -> Result<Group<S>.Data>: Ok{struct{for f, node in ...self.fields: [f]: node.read()?}}',
  'fn load<S is struct { [_] is FormNode }>(self: Group<S>, v: Group<S>.Seen):',
  '  for f, node in ...self.fields: node.load(v[f])',
].join('\n');
