// Kino's rules for the playback boundary (ADR 0032). Both judge an import by the file it resolves
// to rather than by how the specifier is spelled, so a renamed import, a '.ts' or '.js' suffix, a
// '../x/../' detour, a namespace import, a re-export, a type import, a module augmentation or a
// literal dynamic import all count. Relative specifiers only: a package import is not part of any
// boundary here. A symlink counts as the path it sits at, not the file it points to.
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const every = Symbol('every name');
const suffixes = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

/** A directory with its symlinks resolved, so a checkout reached through one still matches. */
function real(directory) {
  try {
    return realpathSync(directory);
  } catch {
    const parent = dirname(directory);
    return parent === directory ? directory : join(real(parent), basename(directory));
  }
}

/** The repository root and the linted file, on the same resolved footing. */
function located(context) {
  const [{ root, zones }] = context.options;
  const filename = join(real(dirname(context.filename)), basename(context.filename));
  return { root: real(root), filename, zones };
}

const repositoryPath = (root, path) => relative(root, path).split(sep).join('/');

/** The repository path an import resolves to, or the plain path when no file answers it. */
function target(root, importer, specifier) {
  const base = resolve(dirname(importer), specifier.split('?')[0]);
  const candidates = suffixes.map((suffix) => base + suffix);
  // Bundler resolution maps a '.js' specifier onto the TypeScript source.
  if (/\.jsx?$/.test(base)) candidates.push(base.replace(/\.js(x?)$/, '.ts$1'));
  return repositoryPath(root, candidates.find(isFile) ?? base);
}

/** A directory ends in '/', a suffix starts with '*', and anything else names one file. */
const within = (path) => (entry) =>
  entry.endsWith('/')
    ? path.startsWith(entry)
    : entry.startsWith('*')
      ? path.endsWith(entry.slice(1))
      : path === entry;

const nameOf = (node) => (node.type === 'Identifier' ? node.name : node.value);

/** The binding a type name starts from, and the member it takes from that binding. */
function referenced(name) {
  if (name.type !== 'TSQualifiedName') return [nameOf(name), every];
  return name.left.type === 'Identifier'
    ? [name.left.name, name.right.name]
    : referenced(name.left);
}

/** The names a statement takes from its module: `every` for a namespace or a dynamic import. */
function importedNames(node) {
  switch (node.type) {
    case 'ImportDeclaration':
      return node.specifiers.map((specifier) =>
        specifier.type === 'ImportSpecifier'
          ? nameOf(specifier.imported)
          : specifier.type === 'ImportDefaultSpecifier'
            ? 'default'
            : every,
      );
    case 'ExportNamedDeclaration':
      return node.specifiers.map((specifier) => nameOf(specifier.local));
    case 'TSImportType':
      return [node.qualifier ? referenced(node.qualifier)[0] : every];
    default:
      return [every];
  }
}

function specifierOf(node) {
  const source =
    node.type === 'TSImportEqualsDeclaration'
      ? node.moduleReference.expression
      : node.type === 'TSModuleDeclaration'
        ? node.id
        : node.source;
  if (source?.type === 'Literal' && typeof source.value === 'string') return source.value;
  if (source?.type === 'TemplateLiteral' && source.expressions.length === 0)
    return source.quasis[0].value.cooked;
  return null;
}

/** Whether `zone` closes `name` of the module at `path`. */
const closes = (zone, path, name) =>
  zone.from.some(within(path)) &&
  !zone.allow?.some(within(path)) &&
  (!zone.importNames || name === every || zone.importNames.includes(name));

const paths = { type: 'array', items: { type: 'string' } };
const zone = (properties = {}, required = []) => ({
  type: 'object',
  properties: { from: paths, importNames: paths, ...properties },
  required: ['from', ...required],
  additionalProperties: false,
});
const options = (zones) => [
  {
    type: 'object',
    properties: { root: { type: 'string' }, zones: { type: 'array', items: zones } },
    required: ['root', 'zones'],
    additionalProperties: false,
  },
];

const importBoundary = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keeps a module, or some of its names, to the files a zone allows to import them.',
    },
    schema: options(
      zone({ allow: paths, importers: paths, message: { type: 'string' } }, ['message']),
    ),
  },
  create(context) {
    const { root, filename, zones } = located(context);
    const importer = repositoryPath(root, filename);
    const open = zones.filter((entry) => !entry.importers?.some(within(importer)));
    const check = (node) => {
      const specifier = specifierOf(node);
      if (!specifier?.startsWith('.')) return;
      const path = target(root, filename, specifier);
      const names = importedNames(node);
      const closed = open.find((entry) => names.some((name) => closes(entry, path, name)));
      if (closed) context.report({ node, message: closed.message });
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
      TSImportType: check,
      TSImportEqualsDeclaration: check,
      TSModuleDeclaration: check,
    };
  },
};

const isCast = (node) => node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion';

/** The first node in the tree under `node`, itself included, that `test` accepts. */
function find(node, test) {
  if (test(node)) return node;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    for (const child of [value].flat()) {
      const found = child && typeof child.type === 'string' && find(child, test);
      if (found) return found;
    }
  }
  return null;
}

// A cast is the one way past a type, so it may not aim at the types that keep the Player model in
// the session: the branded actions, the transports and the model names. A type predicate is a cast
// the compiler takes on trust, so it may not either.
const noBoundaryCast = {
  meta: {
    type: 'problem',
    docs: { description: 'Keeps casts off the types that fence the Player model.' },
    schema: options(zone()),
    messages: {
      twice:
        "Cast once, from the value's own type. A cast through another type, such as `as unknown as`, gets around the types that keep the Player model in the playback session (ADR 0032).",
      never:
        'A cast to `never` passes any value anywhere, past the types that keep the Player model in the playback session (ADR 0032).',
      named:
        'Do not cast to {{name}}: build actions with core/actions.ts and name models as they are, so the types keep the Player model in the playback session (ADR 0032).',
      predicate:
        'Do not narrow to {{name}} with a type predicate: build actions with core/actions.ts and name models as they are, so the types keep the Player model in the playback session (ADR 0032).',
    },
  },
  create(context) {
    const { root, filename, zones } = located(context);
    const bindings = new Map();
    const fenced = (path, name) => zones.some((entry) => closes(entry, path, name));
    const resolved = (specifier) =>
      specifier?.startsWith('.') ? target(root, filename, specifier) : null;
    const fencedType = (part) => {
      if (part.type === 'TSImportType') {
        const path = resolved(specifierOf(part));
        return Boolean(path) && fenced(path, importedNames(part)[0]);
      }
      if (part.type !== 'TSTypeReference' && part.type !== 'TSTypeQuery') return false;
      const [local, member] = referenced(part.typeName ?? part.exprName);
      const binding = bindings.get(local);
      return (
        Boolean(binding) && fenced(binding.path, binding.name === every ? member : binding.name)
      );
    };
    const reportFenced = (node, type, messageId) => {
      const named = find(type, fencedType);
      if (named)
        context.report({ node, messageId, data: { name: context.sourceCode.getText(named) } });
    };
    return {
      // A cast may come before an import in the file, so every binding is read first.
      Program(program) {
        for (const node of program.body) {
          const path = node.type === 'ImportDeclaration' && resolved(specifierOf(node));
          if (!path) continue;
          importedNames(node).forEach((name, index) =>
            bindings.set(node.specifiers[index].local.name, { path, name }),
          );
        }
      },
      'TSAsExpression, TSTypeAssertion'(node) {
        const type = node.typeAnnotation;
        if (type.type === 'TSTypeReference' && type.typeName.name === 'const') return;
        if (isCast(node.expression)) return context.report({ node, messageId: 'twice' });
        if (type.type === 'TSNeverKeyword') return context.report({ node, messageId: 'never' });
        reportFenced(node, type, 'named');
      },
      TSTypePredicate(node) {
        if (node.typeAnnotation)
          reportFenced(node, node.typeAnnotation.typeAnnotation, 'predicate');
      },
    };
  },
};

export default { rules: { 'import-boundary': importBoundary, 'no-boundary-cast': noBoundaryCast } };
