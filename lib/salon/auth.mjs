import {pbkdf2Async} from '@noble/hashes/pbkdf2.js';
import {sha256} from '@noble/hashes/sha2.js';
import {Secret, TOTP} from 'otpauth';
import {fail, throttle} from './security.mjs';

const enc = new TextEncoder();
export const hex = value => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join('');
export const random = (length = 32) => hex(crypto.getRandomValues(new Uint8Array(length)));
export const sha = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export const PASSWORD_ITERATIONS = 600000;
export async function passwordHash(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  try { return hex(await crypto.subtle.deriveBits({name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256'}, key, 256)); }
  catch (error) {
    // Workerd caps WebCrypto PBKDF2 at 100,000. Use the same standard KDF,
    // with the full work factor, through the audited portable implementation.
    if (!/iteration|not supported/i.test(error.message)) throw error;
    return hex(await pbkdf2Async(sha256, enc.encode(password), enc.encode(salt), {c: iterations, dkLen: 32}));
  }
}
export async function verifyPassword(password, owner) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 128) return false;
  const iterations = owner?.passwordIterations || 100000;
  if (![100000, PASSWORD_ITERATIONS].includes(iterations)) return false;
  const hash = await passwordHash(password, owner?.salt || 'unregistered-owner', owner ? iterations : PASSWORD_ITERATIONS);
  return !!owner && equal(hash, owner.passwordHash);
}
export async function passwordRecord(password) {
  const salt = random(16);
  return {salt, passwordHash: await passwordHash(password, salt), passwordIterations: PASSWORD_ITERATIONS};
}
const cookieName = request => new URL(request.url).protocol === 'https:' ? '__Host-iqra_session' : 'iqra_session';
export const cookieToken = request => {
  const values = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(cookieName(request) + '='));
  if (values.length !== 1) return '';
  const token = values[0].slice(cookieName(request).length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
};
export const sessionCookie = (request, token, age = 28800) => `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
export const publicUser = owner => ({email: owner.email, mfaEnabled: !!owner.totpSecret});
export async function admin(request, store) {
  const token = cookieToken(request); if (!token) return null;
  const id = await sha(token), record = await store.get('sessions', id);
  if (!record) return null;
  const owner = await store.get('admin', 'owner');
  if (!record.authVersion || record.authVersion !== owner?.authVersion || record.email !== owner.email || record.expires <= Date.now() || record.lastSeen < Date.now() - 1800000) {
    await store.remove('sessions', id); return null;
  }
  if (record.lastSeen < Date.now() - 300000) await store.put('sessions', id, {...record, lastSeen: Date.now()});
  return {owner, sessionId: id};
}
export async function newSession(request, store, owner) {
  const token = random(), previous = cookieToken(request);
  if (previous) await store.remove('sessions', await sha(previous));
  await store.prune();
  await store.put('sessions', await sha(token), {email: owner.email, authVersion: owner.authVersion, lastSeen: Date.now(), expires: Date.now() + 28800000});
  return {data: {user: publicUser(owner)}, headers: {'Set-Cookie': sessionCookie(request, token)}};
}
export async function replaceOwner(store, owner, next) {
  if (!await store.replaceOwner(owner.authVersion || null, next)) fail('The account changed. Please sign in again.', 409);
  return next;
}
async function encryptionKey(env) {
  if (!/^[a-f0-9]{64}$/.test(env.AUTH_SECRET || '')) fail('Authenticator setup is not configured. Please contact the owner.', 503);
  return crypto.subtle.importKey('raw', Uint8Array.from(env.AUTH_SECRET.match(/../g), x => parseInt(x, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptSecret(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: enc.encode('iqra-admin-totp-v1')}, await encryptionKey(env), enc.encode(value));
  return `${hex(iv)}.${hex(ciphertext)}`;
}
async function decryptSecret(value, env) {
  const [iv, ciphertext] = value.split('.').map(x => Uint8Array.from(x.match(/../g), b => parseInt(b, 16)));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv, additionalData: enc.encode('iqra-admin-totp-v1')}, await encryptionKey(env), ciphertext));
}
const totp = (secret, email) => new TOTP({issuer: 'Iqra Signature Salon', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret)});
export async function enrollment(email, env) {
  const secret = new Secret({size: 20}).base32;
  return {secret, uri: totp(secret, email).toString(), encrypted: await encryptSecret(secret, env)};
}
export async function verifySecondFactor(owner, code, store, env, {allowRecovery = true} = {}) {
  if (!owner.totpSecret) return true;
  if (typeof code !== 'string' || code.length > 40) return false;
  const normalized = code.replace(/[ -]/g, '');
  let useId, expires;
  if (/^\d{6}$/.test(normalized)) {
    const generator = totp(await decryptSecret(owner.totpSecret, env), owner.email);
    const delta = generator.validate({token: normalized, window: 1});
    if (delta === null) return false;
    useId = `${owner.mfaVersion}:totp:${Math.floor(Date.now() / 30000) + delta}`;
    expires = Date.now() + 120000;
  } else if (allowRecovery && /^[a-f0-9]{20}$/i.test(normalized)) {
    const hash = await sha(normalized.toLowerCase());
    if (!owner.recoveryHashes?.some(x => equal(x, hash))) return false;
    useId = `${owner.mfaVersion}:recovery:${hash}`;
    // Recovery claims remain valid for the lifetime of this enrollment.
    expires = null;
  } else return false;
  return store.insert('mfa-used', useId, {expires});
}
export async function reauthenticate(input, user, store, env, {secondFactor = true} = {}) {
  await throttle(store, 'account:' + user.owner.authVersion, 10, 900);
  if (!await verifyPassword(input.currentPassword, user.owner)) fail('Current password is incorrect.', 403);
  if (secondFactor && !await verifySecondFactor(user.owner, input.code, store, env)) fail('Enter a valid authenticator or recovery code.', 403);
}
