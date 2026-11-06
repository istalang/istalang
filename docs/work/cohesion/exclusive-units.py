"""Units (top-level declarations of src) used by exactly one other place: cohesion candidates.

  python3 exclusive-units.py [repo]                 every unit whose users all sit in one other file
  python3 exclusive-units.py [repo] --into <path>   units used only by <path> (a file or folder), to a fixpoint

A unit's users are the units of its own file that reference it and the units of files importing it
that reference the imported name; src and test both count. Users in the unit's own test file
(x.test.ts beside x.ts) are the unit's own. Regex-based: a name shadowed locally can over-count users,
so treat the output as candidates to read, not as a verdict."""
import os, re, sys, collections

args = sys.argv[1:]
into = None
if '--into' in args:
    i = args.index('--into')
    into = args[i + 1].rstrip('/')
    del args[i:i + 2]
os.chdir(args[0] if args else '.')

files = sorted(os.path.normpath(os.path.join(d, f))
               for top in ('src', 'test') for d, _, fs in os.walk(top) for f in fs if f.endswith('.ts'))

def strip_comments(text):
    text = re.sub(r'/\*[\s\S]*?\*/', lambda m: '\n' * m.group(0).count('\n'), text)
    return re.sub(r'(?m)(^|\s)//.*$', r'\1', text)

def strip_strings(text):
    return re.sub(r"'(?:[^'\\\n]|\\.)*'", "''", text)

decl = re.compile(r'^(export\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)', re.M)
imp = re.compile(r"import\s+(type\s+)?(?:\{([^}]*)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+'([^']+)'")

units, exported, imports = {}, set(), {}
for f in files:
    text = strip_comments(open(f).read())
    local = {}
    for m in imp.finditer(text):
        if not m.group(5).startswith('.'):
            continue
        target = os.path.normpath(os.path.join(os.path.dirname(f), m.group(5)))
        if m.group(2) is not None:
            for part in filter(None, (p.strip() for p in m.group(2).split(','))):
                part = re.sub(r'^type\s+', '', part)
                name, alias = ([x.strip() for x in part.split(' as ')] if ' as ' in part else (part, part))
                local[alias] = (target, name)
        elif m.group(3):
            local[m.group(3)] = (target, '*')
        elif m.group(4):
            local[m.group(4)] = (target, 'default')
    imports[f] = local
    text = strip_strings(text)
    starts = [(m.start(), m.group(3), bool(m.group(1))) for m in decl.finditer(text)]
    body_start = max([m.end() for m in imp.finditer(text)] + [0])
    for i, (pos, name, exp) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        units[(f, name)] = units.get((f, name), '') + text[pos:end]
        if exp:
            exported.add((f, name))
    units[(f, '<top>')] = text[body_start:starts[0][0]] if starts else text[body_start:]

users = collections.defaultdict(set)
word = re.compile(r'[A-Za-z_$][\w$]*')
names_in = collections.defaultdict(set)
for f, name in units:
    names_in[f].add(name)
for (f, name), text in units.items():
    refs = set(word.findall(text))
    for other in names_in[f]:
        if other not in (name, '<top>') and other in refs:
            users[(f, other)].add((f, name))
    for alias, (target, imported) in imports[f].items():
        if imported == '*':
            for m in re.finditer(re.escape(alias) + r'\.(\w+)', text):
                users[(target, m.group(1))].add((f, name))
        elif alias in refs:
            users[(target, imported)].add((f, name))

def own_test(f):
    return f[:-3] + '.test.ts'

def outside_users(u):
    return {x for x in users.get(u, set()) if x[0] != own_test(u[0])}

def inside(f):
    return f == into or f.startswith(into + '/') or f == into + '.ts'

if into:
    moved, order, changed = {u for u in units if inside(u[0])}, [], True
    while changed:
        changed = False
        for u in sorted(units):
            if u in moved or u[1] == '<top>' or not u[0].startswith('src/'):
                continue
            us = outside_users(u)
            if us and us <= moved:
                moved.add(u)
                order.append(u)
                changed = True
    for f, name in order:
        print(f"{f}\t{name}\t{'export' if (f, name) in exported else 'local'}")
else:
    for u in sorted(units):
        if u[1] == '<top>' or u not in exported or not u[0].startswith('src/'):
            continue
        homes = {x[0] for x in outside_users(u) if x[0] != u[0]}
        if len(homes) == 1 and not any(x[0] == u[0] for x in outside_users(u)):
            print(f"{u[0]}\t{u[1]}\t-> {next(iter(homes))}")
