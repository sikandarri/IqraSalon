import {seedRecords, contentKinds} from './seed.mjs';
import {parse, schemas, settingsSchema, bookingSchema, accountSchema, loginSchema} from './validation.mjs';
import {fail, checkRequest, jsonBody, throttle, securityHeaders, byteRange} from './security.mjs';
import {sha, equal, random, admin, publicUser, newSession, cookieToken, sessionCookie, passwordRecord, verifyPassword, replaceOwner, PASSWORD_ITERATIONS, enrollment, verifySecondFactor, reauthenticate} from './auth.mjs';
import {inspectUpload, publicMedia, mediaInUse, validateAssets, visible} from './media.mjs';
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', ...headers}});
const clean = record => { if (!record) return record; const {kind, ...data} = record; return data; };
const loginResponse = async (request, store, owner, extra = {}) => { const s = await newSession(request, store, owner); return json({...s.data, ...extra}, 200, s.headers); };
const normalizePhone = phone => phone.replace(/[^0-9]/g, '').replace(/^0(?=3)/, '92');
const bookingFingerprint = b => sha(JSON.stringify([b.name, normalizePhone(b.phone), b.email, b.serviceId, b.date, b.time, b.notes]));

async function dispatch(request, {store, files, env = {}}) {
  checkRequest(request, env);
  const url = new URL(request.url), method = request.method;
  const match = /^\/api\/([a-z]+)(?:\/([a-zA-Z0-9_-]{1,100}))?\/?$/.exec(url.pathname);
  if (!match) fail('Action not found.', 404);
  const [, route, id] = match;
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fail('Method not allowed.', 405);
  if (!await store.get('meta', 'seeded')) {
    for (const r of seedRecords) await store.insert(r.kind, r.id, r.data);
    await store.insert('meta', 'seeded', {version: 1});
  }
  // CLIENT_IP is set by the runtime adapter, never copied from arbitrary
  // forwarding headers in the shared API or the standalone Express server.
  const ipHash = await sha(env.CLIENT_IP || 'unknown');
  if (route === 'health' && !id && method === 'GET') return json({ok: true});
  if (route === 'content' && !id && method === 'GET') {
    const result = {settings: clean(await store.get('settings', 'main'))};
    for (const kind of contentKinds) result[kind] = (await store.list(kind)).filter(x => visible(kind, x)).sort((a, b) => a.order - b.order).map(clean);
    return json(result);
  }
  if (route === 'auth') {
    if (id === 'me' && method === 'GET') { const user = await admin(request, store); return json({user: user ? publicUser(user.owner) : null, needsSetup: !await store.get('admin', 'owner')}); }
    if (['setup', 'login'].includes(id) && method === 'POST') {
      await throttle(store, 'auth:ip:' + ipHash, 20, 900);
      const input = await jsonBody(request, 4096);
      if (id === 'setup') {
        if (!/^[a-f0-9]{64}$/.test(env.SETUP_TOKEN || '') || !equal(input.setupToken, env.SETUP_TOKEN)) fail('Use your private setup link to create the admin account.', 403);
        if (await store.get('admin', 'owner')) fail('Admin is already set up. Please sign in.', 409);
        const a = parse(accountSchema, input), owner = {email: a.email, ...await passwordRecord(a.password), authVersion: random()};
        if (!await store.insert('admin', 'owner', owner)) fail('Admin is already set up. Please sign in.', 409);
        return loginResponse(request, store, owner);
      }
      const inputLogin = parse(loginSchema, input);
      await throttle(store, 'auth:account:' + await sha(inputLogin.email), 30, 900);
      let owner = await store.get('admin', 'owner');
      const passwordValid = await verifyPassword(inputLogin.password, owner);
      if (!passwordValid || owner.email !== inputLogin.email) fail('Email or password is incorrect.', 401);
      if (!await verifySecondFactor(owner, inputLogin.code, store, env)) fail('Enter a valid authenticator or recovery code.', 401);
      if (!owner.authVersion || owner.passwordIterations !== PASSWORD_ITERATIONS) {
        owner = await replaceOwner(store, owner, {...owner, ...await passwordRecord(inputLogin.password), authVersion: random()});
      }
      return loginResponse(request, store, owner);
    }
    if (id === 'logout' && method === 'POST') {
      await store.remove('sessions', await sha(cookieToken(request)));
      return json({ok: true}, 200, {'Set-Cookie': sessionCookie(request, '', 0)});
    }
    fail('Action not found.', 404);
  }
  if (route === 'bookings' && !id && method === 'POST') {
    await throttle(store, 'booking:attempt:' + ipHash, 30, 3600);
    if (!(await store.get('settings', 'main')).bookingEnabled) fail('Appointment requests are currently paused.', 409);
    const b = parse(bookingSchema, await jsonBody(request, 8192)), fingerprint = await bookingFingerprint(b);
    const previous = await store.get('bookings', b.requestId);
    if (previous) {
      if (!equal(previous.fingerprint || await bookingFingerprint(previous), fingerprint)) fail('This request identifier is already in use. Start a new request.', 409);
      return json({reference: previous.reference});
    }
    const when = new Date(`${b.date}T${b.time}:00+05:00`).getTime();
    if (!Number.isFinite(when) || when < Date.now() || when > Date.now() + 366 * 86400000) fail('Choose a future date within the next year.');
    const service = await store.get('services', b.serviceId); if (!service?.published) fail('Choose an available service.');
    await throttle(store, 'booking:ip:' + ipHash, 8, 3600);
    await throttle(store, 'booking:phone:' + await sha(normalizePhone(b.phone)), 8, 86400);
    const {website, consent, ...record} = b;
    await store.insert('bookings', b.requestId, {...record, fingerprint, serviceName: service.title, status: 'pending', reference: 'IQ-' + random(6).toUpperCase(), createdAt: new Date().toISOString(), consentAt: new Date().toISOString()});
    const saved = await store.get('bookings', b.requestId);
    if (!equal(saved.fingerprint, fingerprint)) fail('This request identifier is already in use. Start a new request.', 409);
    return json({reference: saved.reference}, 201);
  }
  const user = await admin(request, store);
  if (route === 'media' && id && ['GET', 'HEAD'].includes(method)) {
    const media = await store.get('media', id);
    if (!media || (!user && !await publicMedia(store, id))) fail('File not found.', 404);
    const range = byteRange(request.headers.get('range'), media.size);
    const headers = {'Content-Type': media.mime, 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'Content-Disposition': 'inline', 'Content-Length': String(range?.length || media.size)};
    if (range) headers['Content-Range'] = `bytes ${range.offset}-${range.offset + range.length - 1}/${media.size}`;
    if (method === 'HEAD') return new Response(null, {status: range ? 206 : 200, headers});
    const object = await files.get(media.key, range); if (!object) fail('File not found.', 404);
    return new Response(object.body, {status: range ? 206 : 200, headers});
  }
  if (!user) fail('Please sign in to manage the salon.', 401);
  if (route === 'admin' && !id && method === 'GET') {
    const data = {settings: clean(await store.get('settings', 'main')), user: publicUser(user.owner)};
    for (const kind of [...contentKinds, 'bookings', 'media']) data[kind] = (await store.list(kind)).map(clean);
    return json(data);
  }
  if (route === 'account' && !id && method === 'PUT') {
    const input = await jsonBody(request, 4096), a = parse(accountSchema, input);
    await reauthenticate(input, user, store, env);
    const owner = await replaceOwner(store, user.owner, {...user.owner, email: a.email, ...await passwordRecord(a.password), authVersion: random()});
    await store.removeAll('sessions');
    return loginResponse(request, store, owner);
  }
  if (route === 'mfa') {
    if (!id && method === 'GET') return json({enabled: !!user.owner.totpSecret, available: /^[a-f0-9]{64}$/.test(env.AUTH_SECRET || '')});
    if (id === 'enroll' && method === 'POST') {
      if (user.owner.totpSecret) fail('Authenticator protection is already enabled.', 409);
      await reauthenticate(await jsonBody(request, 4096), user, store, env);
      const e = await enrollment(user.owner.email, env);
      await store.put('mfa-pending', user.sessionId, {totpSecret: e.encrypted, mfaVersion: random(), authVersion: user.owner.authVersion, expires: Date.now() + 600000});
      return json({secret: e.secret, uri: e.uri});
    }
    if (id === 'enable' && method === 'POST') {
      await throttle(store, 'mfa:enable:' + user.sessionId, 10, 900);
      const input = await jsonBody(request, 2048), pending = await store.get('mfa-pending', user.sessionId);
      if (user.owner.totpSecret || !pending || pending.expires <= Date.now() || pending.authVersion !== user.owner.authVersion) fail('Start authenticator setup again.', 409);
      if (!await verifySecondFactor({...pending, email: user.owner.email}, input.code, store, env, {allowRecovery: false})) fail('Enter a valid authenticator code.', 403);
      const recoveryCodes = Array.from({length: 8}, () => random(10));
      const owner = await replaceOwner(store, user.owner, {...user.owner, totpSecret: pending.totpSecret, mfaVersion: pending.mfaVersion, recoveryHashes: await Promise.all(recoveryCodes.map(sha)), authVersion: random()});
      await store.remove('mfa-pending', user.sessionId); await store.removeAll('sessions');
      return loginResponse(request, store, owner, {recoveryCodes});
    }
    if (id === 'disable' && method === 'POST') {
      if (!user.owner.totpSecret) fail('Authenticator protection is not enabled.', 409);
      await reauthenticate(await jsonBody(request, 4096), user, store, env);
      const {totpSecret, mfaVersion, recoveryHashes, ...rest} = user.owner;
      const owner = await replaceOwner(store, user.owner, {...rest, authVersion: random()});
      await store.removeAll('sessions');
      return loginResponse(request, store, owner);
    }
    fail('Action not found.', 404);
  }
  if (route === 'settings' && !id && method === 'PUT') {
    const data = parse(settingsSchema, await jsonBody(request)); await validateAssets(store, 'settings', data);
    await store.put('settings', 'main', data); return json(data);
  }
  if (contentKinds.includes(route)) {
    if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
      const data = parse(schemas[route], await jsonBody(request));
      if (method === 'PUT' && !await store.get(route, id)) fail('This item no longer exists.', 404);
      await validateAssets(store, route, data);
      return json(clean(await store.put(route, id || crypto.randomUUID(), data)), method === 'POST' ? 201 : 200);
    }
    if (method === 'DELETE' && id) { await store.remove(route, id); return json({ok: true}); }
  }
  if (route === 'bookings' && id) {
    if (method === 'DELETE') { await store.remove(route, id); return json({ok: true}); }
    if (method === 'PATCH') {
      const input = await jsonBody(request, 1024); if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(input.status)) fail('Choose a valid status.');
      const b = await store.get('bookings', id); if (!b) fail('Request not found.', 404);
      return json(await store.put('bookings', id, {...clean(b), status: input.status}));
    }
  }
  if (route === 'upload' && !id && method === 'POST') {
    await throttle(store, 'upload:count:' + user.owner.authVersion, 60, 3600);
    const {file, ...metadata} = await inspectUpload(request);
    await throttle(store, 'upload:bytes:' + user.owner.authVersion, 512 * 1024 * 1024, 86400, file.size);
    const mediaId = crypto.randomUUID(), key = 'salon/' + mediaId, media = {...metadata, key, url: '/api/media/' + mediaId};
    await files.put(key, file, metadata.mime);
    try { await store.put('media', mediaId, media); } catch (error) { await files.remove(key); throw error; }
    return json({id: mediaId, ...media}, 201);
  }
  if (route === 'media' && id && method === 'DELETE') {
    if (await mediaInUse(store, id)) fail('Remove this file from its content or site settings first.', 409);
    const media = await store.get('media', id); if (media) await files.remove(media.key);
    await store.remove('media', id); return json({ok: true});
  }
  fail('Action not found.', 404);
}

export async function handleApi(request, context) {
  let response;
  try { response = await dispatch(request, context); }
  catch (error) {
    if (!error.status) console.error('Salon API failure', {type: error.name, requestId: crypto.randomUUID()});
    response = json({error: error.status ? error.message : 'We could not complete that request. Please try again.'}, error.status || 503, error.headers || {});
  }
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders({api: true, https: new URL(request.url).protocol === 'https:'}))) headers.set(key, value);
  return new Response(response.body, {status: response.status, headers});
}
