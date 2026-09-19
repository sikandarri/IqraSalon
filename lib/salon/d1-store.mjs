export function d1Store(db) {
  const unpack = r => r ? {...JSON.parse(r.data), id: r.id, kind: r.kind, updatedAt: r.updated_at} : null;
  return {
    get: async (kind, id) => unpack(await db.prepare('SELECT * FROM records WHERE kind=? AND id=?').bind(kind, id).first()),
    list: async kind => (await db.prepare('SELECT * FROM records WHERE kind=? ORDER BY updated_at DESC LIMIT 2000').bind(kind).all()).results.map(unpack),
    put: async (kind, id, data) => { const updatedAt = new Date().toISOString(); await db.prepare('INSERT INTO records(kind,id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(kind, id, JSON.stringify(data), updatedAt).run(); return {...data, id, kind, updatedAt}; },
    insert: async (kind, id, data) => !!await db.prepare('INSERT INTO records(kind,id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(kind,id) DO NOTHING RETURNING id').bind(kind, id, JSON.stringify(data), new Date().toISOString()).first(),
    remove: async (kind, id) => { await db.prepare('DELETE FROM records WHERE kind=? AND id=?').bind(kind, id).run(); },
    removeAll: async kind => { await db.prepare('DELETE FROM records WHERE kind=?').bind(kind).run(); },
    replaceOwner: async (version, data) => !!await db.prepare("UPDATE records SET data=?,updated_at=? WHERE kind='admin' AND id='owner' AND json_extract(data,'$.authVersion') IS ? RETURNING id").bind(JSON.stringify(data), new Date().toISOString(), version).first(),
    prune: async () => {
      const now = Date.now();
      await db.prepare('DELETE FROM rate_limits WHERE expires<=?').bind(now).run();
      await db.prepare("DELETE FROM records WHERE kind IN ('sessions','mfa-pending','mfa-used') AND json_extract(data,'$.expires')<=?").bind(now).run();
    },
    increment: async (key, seconds, amount = 1) => {
      const now = Date.now();
      return (await db.prepare('INSERT INTO rate_limits(key,count,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN excluded.count ELSE count+excluded.count END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count').bind(key, amount, now + seconds * 1000, now, now).first()).count;
    },
  };
}
export const r2Files = bucket => ({put: (key, file, mime) => bucket.put(key, file.stream(), {httpMetadata: {contentType: mime}}), get: (key, range) => bucket.get(key, range ? {range} : undefined), remove: key => bucket.delete(key)});
