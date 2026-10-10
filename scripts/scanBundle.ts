/**
 * Scan the built frontend (frontend/dist) for things that must never ship to a browser:
 * credential-shaped strings, server-side variable names, and hard-coded development hosts.
 * A pattern match is evidence to look at, not proof of a leak; a clean scan is not proof of safety either.
 *
 *   npm run check:bundle [dir]        exits 1 if anything is found
 */
import fs from 'node:fs';
import path from 'node:path';

export const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'Google API key shape', pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'secret-key shape (sk-...)', pattern: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: 'GitHub token shape', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Sentry DSN shape', pattern: /https?:\/\/[0-9a-f]{16,}@[^\s"'/]+/i },
  { name: 'server-side variable name', pattern: /GEMINI_API_KEY|SENTRY_DSN|API_PROXY_TARGET|GEMMA_[A-Z_]+|OLLAMA_BASE_URL/ },
  { name: 'development host', pattern: /localhost:\d{2,5}|127\.0\.0\.1|0\.0\.0\.0:\d/ },
];

export interface Finding {
  file: string;
  rule: string;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Text-ish files only (JS, CSS, HTML, JSON, maps, SVG); images and fonts are skipped. */
const TEXT = /\.(js|mjs|css|html|json|map|svg|txt|webmanifest)$/i;

export function scanDir(dir: string): { files: number; findings: Finding[] } {
  let files = 0;
  const findings: Finding[] = [];
  for (const file of walk(dir)) {
    if (!TEXT.test(file)) continue;
    files++;
    const text = fs.readFileSync(file, 'utf8');
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(text)) findings.push({ file: path.relative(dir, file), rule: name });
    }
  }
  return { files, findings };
}

if (require.main === module) {
  const dir = path.resolve(process.argv[2] ?? path.join(__dirname, '..', 'frontend', 'dist'));
  if (!fs.existsSync(dir)) {
    console.error(`No build found at ${dir}. Run "npm run frontend:build" first.`);
    process.exit(2);
  }
  const { files, findings } = scanDir(dir);
  console.log(`scanned ${files} text files in ${dir}`);
  for (const f of findings) console.error(`FOUND ${f.rule} in ${f.file}`);
  console.log(findings.length === 0 ? 'bundle scan: clean' : `bundle scan: ${findings.length} finding(s)`);
  process.exit(findings.length === 0 ? 0 : 1);
}
