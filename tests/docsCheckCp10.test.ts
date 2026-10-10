import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { anchorsOf, checkLinks, findPlaceholders, slug } from '../scripts/checkDocs';

/** CP10: the docs checker finds broken links and anchors, and the repository's own Markdown has none. */
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
function repo(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-docs-'));
  dirs.push(d);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, name)), { recursive: true });
    fs.writeFileSync(path.join(d, name), text);
  }
  return d;
}

describe('slug and anchors (GitHub rules)', () => {
  it.each([
    ['Production', 'production'],
    ['Reliability and testing (Checkpoint 8)', 'reliability-and-testing-checkpoint-8'],
    ["What's `inside`?", 'whats-inside'],
    ['Run it locally', 'run-it-locally'],
    ['A / B', 'a--b'],
  ])('%s -> %s', (heading, expected) => expect(slug(heading)).toBe(expected));

  it('repeated headings get -1, -2; headings inside code fences are ignored', () => {
    const a = anchorsOf('# Same\n\n## Same\n\n```\n# Not a heading\n```\n\n### Same\n');
    expect([...a].sort()).toEqual(['same', 'same-1', 'same-2']);
  });
});

describe('checkLinks', () => {
  it('accepts valid file, directory and anchor links, ignores external links and code samples', () => {
    const root = repo({
      'README.md': '# Title\n\n[a](docs/a.md) [dir](docs/) [anchor](docs/a.md#section-one) [self](#title) [ext](https://example.test/x) [mail](mailto:a@b.test)\n\n```md\n[broken](nope.md)\n```\n\nInline `[broken](nope.md)` is code.\n',
      'docs/a.md': '# A\n\n## Section One\n',
    });
    expect(checkLinks(root)).toMatchObject({ problems: [], links: 4 });
  });

  it('reports a missing file, a missing anchor and a missing self-anchor, with file and line', () => {
    const root = repo({
      'README.md': '# T\n\n[gone](docs/missing.md)\n[bad anchor](docs/a.md#nope)\n[bad self](#nowhere)\n',
      'docs/a.md': '# A\n',
    });
    const { problems } = checkLinks(root);
    expect(problems.map((p) => `${p.file}:${p.line} ${p.problem}`)).toEqual([
      'README.md:3 target does not exist',
      'README.md:4 anchor not found in target',
      'README.md:5 anchor not found in target',
    ]);
  });

  it('resolves links relative to the linking file, and root-relative links from the repository root', () => {
    const root = repo({ 'docs/x/b.md': '[up](../a.md) [root](/README.md)', 'docs/a.md': '# A', 'README.md': '# R' });
    expect(checkLinks(root).problems).toEqual([]);
  });

  it('skips node_modules and dist', () => {
    const root = repo({ 'README.md': '# R', 'node_modules/p/README.md': '[x](nope.md)', 'dist/a.md': '[x](nope.md)' });
    expect(checkLinks(root)).toMatchObject({ files: 1, problems: [] });
  });
});

describe('owner placeholders', () => {
  it('are reported (never a failure) when present, and not when filled in', () => {
    const open = repo({ LICENSE: 'Copyright (c) 2026 <YOUR NAME>', 'SECURITY.md': 'by jangidpiyush16011@gmail.com' });
    expect(findPlaceholders(open).map((p) => p.file).sort()).toEqual(['LICENSE', 'SECURITY.md']);
    const filled = repo({ LICENSE: 'Copyright (c) 2026 Someone', 'SECURITY.md': 'by email' });
    expect(findPlaceholders(filled)).toEqual([]);
  });
});

describe("this repository's own documentation", () => {
  const root = path.resolve(__dirname, '..');
  it('every relative Markdown link and anchor resolves', () => {
    const { problems, links } = checkLinks(root);
    expect(links).toBeGreaterThan(10); // not vacuous
    expect(problems, JSON.stringify(problems, null, 1)).toEqual([]);
  });
  it('the contributor and community files exist and the README links to them', () => {
    for (const f of ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'LICENSE', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml', 'docs/api.md']) {
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    }
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    for (const link of ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'LICENSE', 'docs/api.md', 'docs/architecture.md']) expect(readme).toContain(`](${link})`);
  });
  it('the Code of Conduct keeps the Contributor Covenant 2.1 attribution', () => {
    const coc = fs.readFileSync(path.join(root, 'CODE_OF_CONDUCT.md'), 'utf8');
    expect(coc).toContain('version 2.1, available at <https://www.contributor-covenant.org/version/2/1/code_of_conduct.html>');
    expect(coc).toContain('Mozilla');
    for (const h of ['## Our Pledge', '## Our Standards', '## Enforcement Responsibilities', '## Scope', '## Enforcement', '## Enforcement Guidelines', '### 1. Correction', '### 2. Warning', '### 3. Temporary Ban', '### 4. Permanent Ban', '## Attribution']) expect(coc).toContain(h);
  });
  it('the LICENSE is MIT and matches package.json', () => {
    const lic = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
    expect(lic.startsWith('MIT License')).toBe(true);
    for (const pkg of ['package.json', 'frontend/package.json']) expect(JSON.parse(fs.readFileSync(path.join(root, pkg), 'utf8')).license).toBe('MIT');
  });
});
