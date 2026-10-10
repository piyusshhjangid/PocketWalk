/** Thrown when a provider body exceeds the cap. Callers map it to their own closed-set reason. */
export class BodyTooLargeError extends Error {
  constructor() {
    super('Response body exceeded the size limit');
    this.name = 'BodyTooLargeError';
  }
}

/**
 * Read a response body as text, refusing to buffer more than `maxBytes`. `res.json()` and `res.text()` buffer
 * whatever arrives; a misbehaving or hijacked provider could otherwise make one request cost unbounded memory.
 * Checks Content-Length first (cheap), then counts bytes while streaming (the header can lie or be absent).
 * The stream is cancelled as soon as the cap is crossed.
 */
export async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError();
  }
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Parse bounded text as JSON. Throws BodyTooLargeError, or the JSON SyntaxError. */
export async function readBoundedJson(res: Response, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readBoundedText(res, maxBytes));
}
