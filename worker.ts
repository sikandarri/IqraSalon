import handler from 'vinext/server/fetch-handler';
import {securityHeaders} from './lib/salon/security.mjs';

export default {
  ...handler,
  async fetch(request: Request, env: any, context: any) {
    const url = new URL(request.url);
    let path: string;
    try {path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';}
    catch {return new Response('Bad request', {status: 400});}
    // This site uses direct, access-controlled media URLs. A separate image
    // proxy could bypass those rules or cache private client photos.
    const disabled = /^\/_(?:next|vinext)\/image(?:\/|$)/.test(path);
    // All writes belong to our explicitly protected REST API. No framework
    // server-action endpoints are part of this application.
    const unsupportedWrite = !['GET', 'HEAD'].includes(request.method) && !path.startsWith('/api/');
    if (disabled || unsupportedWrite) return new Response('Not found', {status: disabled ? 404 : 405, headers: {...securityHeaders({api: true}), 'Cache-Control': 'no-store'}});
    const incoming = new Headers(request.headers);
    for (const key of ['x-middleware-subrequest', 'x-middleware-next', 'x-middleware-rewrite', 'content-security-policy', 'content-security-policy-report-only', 'x-nonce']) incoming.delete(key);
    const response = await handler.fetch(new Request(request, {headers: incoming}), env, context);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(securityHeaders({hosted: true, https: url.protocol === 'https:'}))) if (!headers.has(key)) headers.set(key, value);
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
  },
};
