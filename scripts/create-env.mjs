import {writeFile, readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const secret = () => randomBytes(32).toString('hex');
let existing;
try {existing = await readFile('.env', 'utf8');} catch (error) {if (error.code !== 'ENOENT') throw error;}
if (existing !== undefined) {
  if (!/^AUTH_SECRET=/m.test(existing)) {
    await writeFile('.env', existing.trimEnd() + '\nAUTH_SECRET=' + secret() + '\n', {mode: 0o600});
    console.log('Added the authenticator encryption key. Keep your configuration backed up privately.');
  } else console.log('Configuration already exists. Existing settings were preserved.');
} else {
  const token = secret();
  await writeFile('.env', `MONGODB_URI=mongodb://127.0.0.1:27017/iqra_signature\nPUBLIC_ORIGIN=http://localhost:3000\nPORT=3000\nHOST=127.0.0.1\nUPLOAD_DIR=./uploads\nSETUP_TOKEN=${token}\nAUTH_SECRET=${secret()}\nTRUST_PROXY=0\n`, {mode: 0o600, flag: 'wx'});
  console.log('Configuration created. After starting the server, use this private admin setup link:');
  console.log(`http://localhost:3000/admin#setup=${token}`);
}
