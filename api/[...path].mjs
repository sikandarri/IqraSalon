import {createApp} from '../server/app.mjs';
import {connectMongo} from '../server/mongo-store.mjs';
import {mongoFiles} from '../server/mongo-files.mjs';

let appPromise;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
      if (!process.env.PUBLIC_ORIGIN) throw new Error('PUBLIC_ORIGIN is required.');
      const store = await connectMongo(process.env.MONGODB_URI);
      const files = mongoFiles();
      return createApp({
        store,
        files,
        env: {...process.env, RUNTIME_KIND: 'mongodb'},
        clientDirectory: '/tmp/iqra-signature-salon-empty',
      });
    })().catch(error => {
      appPromise = undefined;
      throw error;
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (error) {
    console.error('Vercel API initialization failed', {type: error?.name || 'Error'});
    if (!res.headersSent) res.status(503).json({error: 'Service unavailable. Please try again.'});
  }
}
