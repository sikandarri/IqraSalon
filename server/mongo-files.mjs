import mongoose from 'mongoose';
import {Readable} from 'node:stream';

// Vercel's filesystem is ephemeral, so production media is stored in MongoDB
// GridFS alongside the salon records. This keeps the existing file-store
// interface used by lib/salon/api.mjs without requiring a second storage
// provider.
const BUCKET_NAME = 'salonMedia';
const validKey = key => /^salon\/[a-f0-9-]{36}$/.test(key);

function bucket() {
  const db = mongoose.connection?.db;
  if (!db) throw new Error('MongoDB is not connected.');
  return new mongoose.mongo.GridFSBucket(db, {bucketName: BUCKET_NAME});
}

async function findLatest(key) {
  if (!validKey(key)) throw new Error('Invalid file key');
  const db = mongoose.connection.db;
  const rows = await db.collection(`${BUCKET_NAME}.files`)
    .find({filename: key})
    .sort({uploadDate: -1})
    .limit(1)
    .toArray();
  return rows[0] || null;
}

export function mongoFiles() {
  return {
    async put(key, file, mime) {
      if (!validKey(key)) throw new Error('Invalid file key');
      const b = bucket();
      const source = Readable.fromWeb(file.stream());
      await new Promise((resolve, reject) => {
        const upload = b.openUploadStream(key, {
          contentType: mime,
          metadata: {source: 'iqra-signature-salon', key},
        });
        upload.once('finish', resolve);
        upload.once('error', reject);
        source.once('error', reject);
        source.pipe(upload);
      });
    },

    async get(key, range) {
      const file = await findLatest(key);
      if (!file) return null;
      const options = range ? {start: range.offset, end: range.offset + range.length} : {};
      const stream = bucket().openDownloadStream(file._id, options);
      return {
        body: Readable.toWeb(stream),
        size: file.length,
        range,
      };
    },

    async remove(key) {
      const file = await findLatest(key);
      if (file) await bucket().delete(file._id);
    },
  };
}
