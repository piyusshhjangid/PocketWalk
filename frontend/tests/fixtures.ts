import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Fixture {
  status: number;
  body: unknown;
}

/** Responses captured from the real CP4 backend by `npm run fixtures:frontend` (repo root). */
export function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8')) as Fixture;
}

export function responseFrom(f: Fixture): Response {
  return new Response(JSON.stringify(f.body), { status: f.status, headers: { 'content-type': 'application/json' } });
}
