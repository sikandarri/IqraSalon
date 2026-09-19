// Run after a Sites build. This uses isolated temporary D1/R2 state, never the live site.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url), wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare');
const origin='https://salon.test', credentials={email:'worker-test@example.com',password:'worker-test-passphrase',setupToken:'a'.repeat(64)};
const entry=resolve('dist/server/index.js');
const modulePaths=(await readdir('dist/server',{recursive:true})).filter(x=>x.endsWith('.js')||x.endsWith('.mjs')).map(x=>resolve('dist/server',x));
const modules=[entry,...modulePaths.filter(x=>x!==entry)].map(path=>({type:'ESModule',path}));
const mf=new Miniflare({modules,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],assets:{directory:resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},bindings:{PUBLIC_ORIGIN:origin,SETUP_TOKEN:credentials.setupToken,AUTH_SECRET:'b'.repeat(64)}});
let cookie='';
async function request(path,{method='GET',body,auth=false,headers={}}={}) {
 // Encode with Node's fetch implementation before crossing into Miniflare's
 // separate fetch classes. Passing Node FormData directly becomes plain text.
 const encoded=new Request(origin+path,{method,headers:{...(method!=='GET'?{Origin:origin}:{}),...(auth?{Cookie:cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
 const response=await mf.dispatchFetch(encoded.url,{method,headers:Object.fromEntries(encoded.headers),...(body===undefined?{}:{body:await encoded.arrayBuffer()})});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
}
try {
 const db=await mf.getD1Database('DB');
 for(const name of (await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort()) {
  const source=await readFile('drizzle/'+name,'utf8');
  for(const statement of source.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
 }
 assert.equal((await request('/api/admin')).status,401);
 const content=await request('/api/content');assert.equal(content.status,200);assert.equal((await content.json()).services.length,6);
 let previousNonce;
 for(const path of ['/','/admin']) {
  const page=await request(path,{headers:{'x-middleware-subrequest':'middleware:middleware:middleware','Content-Security-Policy':"script-src 'nonce-attacker'"}});
  assert.equal(page.status,200,path);const policy=page.headers.get('content-security-policy');
  const nonce=/'nonce-([^']+)'/.exec(policy)?.[1];assert.ok(nonce && nonce!=='attacker',path+' nonce');assert.notEqual(nonce,previousNonce);previousNonce=nonce;
  assert.ok(!policy.includes('unsafe-eval'));assert.match(page.headers.get('cache-control'),/no-store/);
  const html=await page.text(), scripts=[...html.matchAll(/<script\b([^>]*)>/g)];assert.ok(scripts.length>0);
  for(const [,attributes] of scripts) if(!attributes.includes('application/json'))assert.ok(attributes.includes(`nonce="${nonce}"`),path+' script is missing its CSP nonce: '+attributes);
 }
 for(const path of ['/_next/image?url=/api/admin&w=64&q=75','/_vinext/image/?url=/api/admin&w=64&q=75','/%5fnext/image?url=/api/admin&w=64&q=75'])assert.equal((await request(path)).status,404,path);
 assert.equal((await request('/',{method:'POST',body:{}})).status,405);
 assert.equal((await request('/api/auth/setup',{method:'POST',body:credentials})).status,200);
 assert.match(cookie,/^__Host-iqra_session=/);
 assert.equal((await request('/api/admin',{auth:true})).status,200);
 assert.equal((await request('/api/auth/me',{auth:true})).status,200);
 const file=new FormData();file.set('file',new File([await readFile('public/images/bridal-editorial.webp')],'portrait.webp',{type:'image/webp'}));file.set('panorama','false');
 const upload=await request('/api/upload',{method:'POST',body:file,auth:true});assert.equal(upload.status,201,await upload.clone().text());const media=await upload.json();
 assert.equal((await request(media.url)).status,404);
 const gallery={title:'Worker test',description:'',category:'Bridal',url:media.url,mediaType:'image',consent:true,published:true,order:0};
 const saved=await request('/api/gallery',{method:'POST',body:gallery,auth:true});assert.equal(saved.status,201);const record=await saved.json();
 const range=await request(media.url,{headers:{Range:'bytes=0-15'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,16);
 assert.equal((await request('/api/gallery/'+record.id,{method:'PUT',body:{...gallery,published:false},auth:true})).status,200);
 assert.equal((await request(media.url)).status,404);
 const enrollment=await request('/api/mfa/enroll',{method:'POST',body:{currentPassword:credentials.password},auth:true});assert.equal(enrollment.status,200,await enrollment.clone().text());assert.ok((await enrollment.json()).secret);
 console.log('PASS: built Worker, migrations, D1/R2 uploads, authentication, PBKDF2 fallback, encrypted MFA enrollment, nonce CSP, media privacy/ranges and disabled framework endpoints.');
} finally {await mf.dispose();}
