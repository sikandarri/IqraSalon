export function fail(message, status = 400, headers = {}) {
  throw Object.assign(new Error(message), {status, headers});
}

export function trustedOrigin(env) {
  try {
    const u = new URL(env.PUBLIC_ORIGIN);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.origin !== env.PUBLIC_ORIGIN || u.username || u.password || (u.protocol !== 'https:' && !local)) throw new Error();
    return u.origin;
  } catch { fail('The website is not configured correctly. Please contact the owner.', 503); }
}

/** @param {{https?: boolean, nonce?: string, hosted?: boolean, api?: boolean}} options */
export function securityHeaders({https = true, nonce, hosted = false, api = false} = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': api ? "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox" : [
      "default-src 'self'",
      `script-src 'self'${nonce ? ` 'nonce-${nonce}' 'strict-dynamic'` : ''}`,
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' https: data: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      `frame-ancestors 'self'${hosted ? ' https://chatgpt.com https://chat.openai.com' : ''}`,
      "frame-src 'none'",
      ...(https ? ['upgrade-insecure-requests'] : []),
    ].join('; '),
  };
  if (https) headers['Strict-Transport-Security'] = 'max-age=31536000';
  if (!hosted) headers['X-Frame-Options'] = api ? 'DENY' : 'SAMEORIGIN';
  return headers;
}

export function checkRequest(request, env) {
  const origin = trustedOrigin(env);
  if (new URL(request.url).origin !== origin) fail('Invalid request origin.', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') fail('Cross-site requests are not allowed.', 403);
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== origin) {
    fail('Please submit this request from the salon website.', 403);
  }
}

export async function limited(request, max) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > max)) fail('This request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); fail('This request is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function jsonBody(request, max = 32768) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('Send JSON content.', 415);
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await limited(request, max))); }
  catch (error) { if (error.status) throw error; fail('The request could not be read.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('Send a JSON object.');
  return result;
}

export async function throttle(store, key, max, seconds, amount = 1) {
  if (await store.increment(key, seconds, amount) > max) {
    fail('Too many requests. Please try again later.', 429, {'Retry-After': String(seconds)});
  }
}

export function byteRange(value, size) {
  if (!value) return undefined;
  const invalid = () => fail('Requested range is not available.', 416, {'Content-Range': `bytes */${size}`});
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) return invalid();
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (![start, end, ...(m[2] ? [Number(m[2])] : [])].every(Number.isSafeInteger) || start < 0 || start > end || start >= size) return invalid();
  return {offset: start, length: end - start + 1};
}
