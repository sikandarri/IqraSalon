import express from 'express';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolve} from 'node:path';
import {handleApi} from '../lib/salon/api.mjs';
import {securityHeaders, trustedOrigin} from '../lib/salon/security.mjs';

export function createApp({store, files, env, clientDirectory = resolve('dist-mern')}) {
  const origin = trustedOrigin(env), app = express();
  app.disable('x-powered-by'); app.disable('etag');
  if (env.TRUST_PROXY && env.TRUST_PROXY !== '0') {
    if (['1', 'true'].includes(env.TRUST_PROXY)) throw new Error('TRUST_PROXY must list trusted proxy IPs or CIDRs, not an unrestricted hop count.');
    app.set('trust proxy', env.TRUST_PROXY.split(',').map(x => x.trim()));
  }
  app.use((req, res, next) => {
    res.set(securityHeaders({https: origin.startsWith('https:')}));
    res.setHeader('Cache-Control', 'private, no-store');
    if (Number(req.headers['content-length'] || 0) > 26 * 1024 * 1024) return res.status(413).set('Connection', 'close').json({error: 'This request is too large.'});
    next();
  });
  app.use('/api', async (req, res) => {
    try {
      const headers = new Headers(Object.entries(req.headers).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : Array.isArray(value) ? value.map(x => [key, x]) : []));
      const request = new Request(new URL(req.originalUrl, origin), {method: req.method, headers, ...(!['GET', 'HEAD'].includes(req.method) ? {body: Readable.toWeb(req), duplex: 'half'} : {})});
      const response = await handleApi(request, {store, files, env: {...env, CLIENT_IP: req.ip, RUNTIME_KIND: 'mongodb'}});
      res.status(response.status); response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) await pipeline(Readable.fromWeb(response.body), res); else res.end();
    } catch (error) {
      if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('HTTP request failed', {type: error.name});
      if (!res.headersSent) res.status(503).json({error: 'Service unavailable. Please try again.'});
      else if (!res.destroyed) res.destroy();
    }
  });
  app.use((req, res, next) => {
    if (/(?:^|\/)\.[^/]|\.map$/i.test(req.path)) return res.status(404).end();
    next();
  });
  app.use(express.static(clientDirectory, {index: false, dotfiles: 'deny', etag: false}));
  app.get(['/', '/admin', '/admin/'], (req, res) => {
    if (req.path.startsWith('/admin')) res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(resolve(clientDirectory, 'index.html'));
  });
  app.use((_req, res) => res.status(404).json({error: 'Page not found.'}));
  app.use((error, _req, res, _next) => {
    console.error('HTTP handler failed', {type: error.name});
    if (!res.headersSent) res.status(500).json({error: 'Request failed.'});
  });
  return app;
}
