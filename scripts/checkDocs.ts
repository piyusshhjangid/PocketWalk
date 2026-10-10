/**
 * Check that relative links and heading anchors in the repository's Markdown files resolve, and list the
 * placeholders that only the repository owner can fill. Offline: external (http/https/mailto) links are NOT checked.
 *
 *   npm run check:docs        exits 1 if a relative link or anchor is broken; placeholders are notices, not failures
 */
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.vitest']);

export interface LinkProblem {
  file: string;
  line: number;
  link: string;
  problem: string;
}

function* markdownFiles(root: string, dir = root): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(root, full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

/** GitHub's heading slug: lower-case, drop punctuation (keep letters, digits, space, hyphen, underscore), spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Lines outside fenced code blocks, with their 1-based numbers. */
function proseLines(text: string): { n: number; line: string }[] {
  const out: { n: number; line: string }[] = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) out.push({ n: i + 1, line });
  });
  return out;
}

export function anchorsOf(text: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const { line } of proseLines(text)) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m?.[1]) continue;
    const base = slug(m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

export function checkLinks(root: string): { files: number; links: number; problems: LinkProblem[] } {
  const problems: LinkProblem[] = [];
  let files = 0;
  let links = 0;
  const anchorCache = new Map<string, Set<string>>();
  const anchorsFor = (file: string): Set<string> => {
    let a = anchorCache.get(file);
    if (!a) anchorCache.set(file, (a = anchorsOf(fs.readFileSync(file, 'utf8'))));
    return a;
  };

  for (const file of markdownFiles(root)) {
    files++;
    const rel = path.relative(root, file);
    for (const { n, line } of proseLines(fs.readFileSync(file, 'utf8'))) {
      const withoutCode = line.replace(/`[^`]*`/g, '');
      for (const m of withoutCode.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1]!;
        if (/^(https?:|mailto:)/i.test(target)) continue;
        links++;
        const [pathPart = '', anchor] = target.split('#');
        const resolved = pathPart === '' ? file : path.resolve(pathPart.startsWith('/') ? root : path.dirname(file), pathPart.replace(/^\//, ''));
        if (!fs.existsSync(resolved)) {
          problems.push({ file: rel, line: n, link: target, problem: 'target does not exist' });
          continue;
        }
        if (anchor && fs.statSync(resolved).isFile() && resolved.endsWith('.md') && !anchorsFor(resolved).has(anchor.toLowerCase())) {
          problems.push({ file: rel, line: n, link: target, problem: 'anchor not found in target' });
        }
      }
    }
  }
  return { files, links, problems };
}

/** Things only the owner can decide or supply. Reported, never a failure. */
export function findPlaceholders(root: string): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  const probes: { file: string; pattern: RegExp }[] = [
    { file: 'LICENSE', pattern: /<YOUR NAME>/ },
    { file: 'CODE_OF_CONDUCT.md', pattern: /\[INSERT CONTACT METHOD\]/ },
    { file: 'SECURITY.md', pattern: /\[INSERT CONTACT METHOD\]/ },
  ];
  for (const { file, pattern } of probes) {
    const full = path.join(root, file);
    if (fs.existsSync(full) && pattern.test(fs.readFileSync(full, 'utf8'))) found.push({ file, text: pattern.source.replace(/\\/g, '') });
  }
  return found;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const { files, links, problems } = checkLinks(root);
  console.log(`checked ${links} relative links in ${files} Markdown files`);
  for (const p of problems) console.error(`BROKEN ${p.file}:${p.line}  ${p.link}  (${p.problem})`);
  for (const ph of findPlaceholders(root)) console.log(`NOTICE owner must fill in ${ph.text} in ${ph.file}`);
  console.log(problems.length === 0 ? 'docs check: all relative links resolve' : `docs check: ${problems.length} broken link(s)`);
  process.exit(problems.length === 0 ? 0 : 1);
}
