import {NextRequest, NextResponse} from 'next/server';
import {securityHeaders} from './lib/salon/security.mjs';

export function middleware(request: NextRequest) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  const headers = securityHeaders({nonce, hosted: true, https: request.nextUrl.protocol === 'https:'});
  const incoming = new Headers(request.headers);
  // Overwrite caller-supplied CSP/nonces before the framework renders scripts.
  incoming.set('Content-Security-Policy', headers['Content-Security-Policy']);
  incoming.delete('Content-Security-Policy-Report-Only');
  incoming.set('x-nonce', nonce);
  const response = NextResponse.next({request: {headers: incoming}});
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  response.headers.set('Cache-Control', 'private, no-store');
  if (request.nextUrl.pathname.startsWith('/admin')) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
export const config = {matcher: ['/', '/admin', '/admin/:path*']};
