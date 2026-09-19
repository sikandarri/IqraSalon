import {createApp} from './app.mjs';
import {connectMongo} from './mongo-store.mjs';
import {localFiles} from './local-files.mjs';
import {trustedOrigin} from '../lib/salon/security.mjs';
trustedOrigin(process.env);
const store = await connectMongo(process.env.MONGODB_URI);
const app = createApp({store, files: localFiles(process.env.UPLOAD_DIR || './uploads'), env: process.env});
const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Iqra Signature Salon is ready.'));
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 80;
let closing = false;
async function close() {
  if (closing) return; closing = true;
  const timer = setTimeout(() => process.exit(1), 10000); timer.unref();
  server.close(async () => { await store.close(); clearTimeout(timer); process.exit(0); });
}
process.on('SIGTERM', close); process.on('SIGINT', close);
