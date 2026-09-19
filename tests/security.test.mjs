import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, symlink, mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {TOTP, Secret} from 'otpauth';
import {harness, account, origin} from './helpers.mjs';
import {handleApi} from '../lib/salon/api.mjs';
import {passwordHash, sha, random, PASSWORD_ITERATIONS} from '../lib/salon/auth.mjs';
import {createApp} from '../server/app.mjs';
import {localFiles} from '../server/local-files.mjs';
import {pbkdf2Async} from '@noble/hashes/pbkdf2.js';
import {sha256} from '@noble/hashes/sha2.js';
const login = h => h.call('auth/login', 'POST', account);
const imageBytes = () => readFile(new URL('../public/images/bridal-editorial.webp', import.meta.url));
const form = (bytes, name='portrait.webp', type='image/webp', panorama=false) => {const f=new FormData(); f.set('file',new File([bytes],name,{type})); f.set('panorama',String(panorama)); return f;};
const service = {title:'Security test',category:'Beauty',description:'',price:100,duration:'1 hour',image:'',published:true,order:0};

test('all management operations reject anonymous callers, forged cookies and extra route segments', async()=>{
 const h=await harness();try {
  const paths=[['admin','GET'],['settings','PUT'],['services','POST'],['services/bridal','PUT'],['services/bridal','DELETE'],['bookings/id','PATCH'],['bookings/id','DELETE'],['upload','POST'],['media/id','DELETE'],['account','PUT'],['mfa','GET'],['mfa/enroll','POST'],['mfa/enable','POST'],['mfa/disable','POST']];
  for(const [path,method] of paths) assert.equal((await h.call(path,method,method==='GET'?undefined:{})).status,401,path);
  assert.equal((await h.call('admin','GET',undefined,{Cookie:'iqra_session='+'f'.repeat(64)})).status,401);
  assert.equal((await h.call('admin/extra/path')).status,404);
  assert.equal((await h.call('auth/setup','POST',{...account,setupToken:'x'.repeat(64)})).status,403);
  const results=await Promise.all([h.call('auth/setup','POST',account),h.call('auth/setup','POST',{...account,email:'other@example.com'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 }finally{await h.close();}
});

test('CSRF, fetch metadata, invalid host, missing configuration and malformed input fail closed',async()=>{
 const h=await harness();try {
  await h.call('auth/setup','POST',account);
  assert.equal((await h.call('services','POST',service,{Origin:'https://attacker.example'})).status,403);
  assert.equal((await h.call('services','POST',service,{Origin:'null'})).status,403);
  assert.equal((await h.call('services','POST',service,{Origin:''})).status,403);
  assert.equal((await h.call('admin','GET',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
  for(const data of [null,[],42,'hello']) assert.equal((await h.call('services','POST',data)).status,400);
  assert.equal((await h.call('services','POST',service,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await h.call('auth/login','POST',{...account,password:'a'.repeat(5000)})).status,413);
  const wrongHost=await handleApi(new Request('https://attacker.example/api/admin'),h);
  assert.equal(wrongHost.status,403);
  const broken=await handleApi(new Request(origin+'/api/content'),{store:h.store,files:h.files,env:{}});
  assert.equal(broken.status,503);
  assert.ok(!(await broken.text()).includes('TypeError'));
 }finally{await h.close();}
});

test('login throttling cannot be bypassed by forged Cloudflare or forwarding headers',async()=>{
 const h=await harness();try {
  await h.call('auth/setup','POST',account);
  for(let i=0;i<19;i++) assert.equal((await h.call('auth/login','POST',{...account,password:'wrong'},{'CF-Connecting-IP':`192.0.2.${i}`,'X-Forwarded-For':`203.0.113.${i}`})).status,401);
  const blocked=await h.call('auth/login','POST',account,{'CF-Connecting-IP':'8.8.8.8'});
  assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'900');
 }finally{await h.close();}
});

test('password upgrades and versioned sessions revoke stale credentials without a list limit',async()=>{
 const h=await harness();try {
  const salt=random(16);
  await h.store.insert('admin','owner',{email:account.email,salt,passwordHash:await passwordHash(account.password,salt,100000)});
  await login(h);
  let owner=await h.store.get('admin','owner'); assert.equal(owner.passwordIterations,PASSWORD_ITERATIONS);
  const oldCookie=h.cookie();const stale=await h.store.get('sessions',await sha(oldCookie.split('=')[1]));
  // Insert an older session beyond the admin listing cap.
  for(let i=0;i<2010;i++) await h.store.put('sessions','overflow-'+i,{...stale,id:undefined});
  const next={email:'new@example.com',password:'a-new-long-password',currentPassword:account.password};
  assert.equal((await h.call('account','PUT',{...next,currentPassword:'wrong'})).status,403);
  assert.equal((await h.call('account','PUT',next)).status,200);
  assert.equal((await h.store.list('sessions')).length,1);
  h.setCookie(oldCookie);assert.equal((await h.call('admin')).status,401);
  owner=await h.store.get('admin','owner');assert.notEqual(owner.authVersion,stale.authVersion);
  // A racing login that inserts an old-version session still cannot authorize.
  const token=random();await h.store.put('sessions',await sha(token),stale);h.setCookie('iqra_session='+token);
  assert.equal((await h.call('admin')).status,401);
  assert.equal((await h.call('auth/login','POST',account)).status,401);
  assert.equal((await h.call('auth/login','POST',next)).status,200);
 }finally{await h.close();}
});

test('idle and absolute expiry, logout, secure cookies and invalid duplicate cookies are enforced',async()=>{
 const h=await harness();try {
  await h.call('auth/setup','POST',account);
  const token=h.cookie().split('=')[1],id=await sha(token),session=await h.store.get('sessions',id);
  await h.store.put('sessions',id,{...session,lastSeen:Date.now()-1800001});assert.equal((await h.call('admin')).status,401);
  await login(h);const sId=await sha(h.cookie().split('=')[1]);await h.store.put('sessions',sId,{...session,expires:Date.now()-1,lastSeen:Date.now()});assert.equal((await h.call('admin')).status,401);
  await login(h);const cookie=h.cookie();h.setCookie(cookie+'; '+cookie);assert.equal((await h.call('admin')).status,401);
  h.setCookie(cookie);await h.call('auth/logout','POST');h.setCookie(cookie);assert.equal((await h.call('admin')).status,401);
  const https='https://salon.example';
  const r=await handleApi(new Request(https+'/api/auth/login',{method:'POST',headers:{Origin:https,'Content-Type':'application/json'},body:JSON.stringify(account)}),{...h,env:{...h.env,PUBLIC_ORIGIN:https}});
  assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/^__Host-iqra_session=/);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict.*; Secure/);assert.ok(!r.headers.get('set-cookie').includes('Domain='));
 }finally{await h.close();}
});

test('authenticator enrollment, encrypted secrets, replay prevention and one-use recovery work',async()=>{
 const h=await harness();try {
  await h.call('auth/setup','POST',account);const firstCookie=h.cookie();
  assert.equal((await h.call('mfa/enroll','POST',{currentPassword:'wrong'})).status,403);
  const response=await h.call('mfa/enroll','POST',{currentPassword:account.password});assert.equal(response.status,200);
  const enrollment=await response.json(),pending=(await h.store.list('mfa-pending'))[0];assert.ok(!JSON.stringify(pending).includes(enrollment.secret));
  const generator=new TOTP({secret:Secret.fromBase32(enrollment.secret),algorithm:'SHA1',digits:6,period:30});
  const code=generator.generate();const enabled=await h.call('mfa/enable','POST',{code});assert.equal(enabled.status,200);
  const result=await enabled.json();assert.equal(result.recoveryCodes.length,8);assert.equal(result.user.mfaEnabled,true);
  const owner=await h.store.get('admin','owner');assert.ok(!JSON.stringify(owner).includes(result.recoveryCodes[0]));
  const activeCookie=h.cookie();h.setCookie(firstCookie);assert.equal((await h.call('admin')).status,401);h.anon();
  assert.equal((await login(h)).status,401);
  assert.equal((await h.call('auth/login','POST',{...account,code})).status,401,'Enrollment code must not be reusable');
  assert.equal((await h.call('auth/login','POST',{...account,code:result.recoveryCodes[0]})).status,200);
  h.anon();assert.equal((await h.call('auth/login','POST',{...account,code:result.recoveryCodes[0]})).status,401);
  // A fresh code in the permitted clock-skew window works exactly once, even concurrently.
  const fresh=generator.generate({timestamp:Date.now()+30000});
  const concurrent=await Promise.all([h.call('auth/login','POST',{...account,code:fresh}),h.call('auth/login','POST',{...account,code:fresh})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,401]);
  h.setCookie(activeCookie);assert.equal((await h.call('mfa/disable','POST',{currentPassword:account.password,code:result.recoveryCodes[1]})).status,200);
  assert.equal((await h.store.get('admin','owner')).totpSecret,undefined);
  h.anon();assert.equal((await login(h)).status,200);
 }finally{await h.close();}
});

test('uploaded bytes, extension, MIME, panorama shape, filename and size are checked on the server',async()=>{
 const h=await harness();try {
  const bytes=await imageBytes();assert.equal((await h.call('upload','POST',form(bytes))).status,401);
  await h.call('auth/setup','POST',account);
  const bad=[form('<script>alert(1)</script>','x.webp'),form(bytes,'x.html'),form(bytes,'x.png','image/png'),form(bytes,'x.woff','font/woff'),form(bytes,'x.webp','image/webp',true),form('<svg onload="alert(1)"/>','x.svg','image/svg+xml'),form(Buffer.from('icns0000000000000000'),'x.webp','image/webp'),form(bytes,'x.webp','image/jpeg')];
  for(const f of bad) assert.equal((await h.call('upload','POST',f)).status,400);
  assert.equal((await h.call('upload','POST',form(bytes),{'Content-Length':String(27*1024*1024)})).status,413);
  const duplicate=form(bytes);duplicate.append('file',new File([bytes],'other.webp',{type:'image/webp'}));assert.equal((await h.call('upload','POST',duplicate)).status,400);
 }finally{await h.close();}
});

test('private media cannot be published by mentioning its path in plain text',async()=>{
 const h=await harness();try {
  await h.call('auth/setup','POST',account);const m=await(await h.call('upload','POST',form(await imageBytes()))).json();assert.ok(m.id);
  await h.call('faqs','POST',{title:'Mention',description:'An internal reference '+m.url,published:true,order:0});
  const settings=(await(await h.call('content')).json()).settings;
  await h.call('settings','PUT',{...settings,about:m.url});h.anon();assert.equal((await h.call('media/'+m.id)).status,404);
  await login(h);const gallery={title:'Photo',description:'',category:'Bridal',url:m.url,mediaType:'image',consent:true,published:true,order:0};
  const published=await(await h.call('gallery','POST',gallery)).json();h.anon();
  const response=await h.call('media/'+m.id);assert.equal(response.status,200);await response.arrayBuffer();
  const invalid=await h.call('media/'+m.id,'GET',undefined,{Range:'bytes=99999999-'});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */'+m.size);
  for(const range of ['bytes=-0','bytes=-','bytes=0-1,3-4','bytes=9999999999999999999999999-']) assert.equal((await h.call('media/'+m.id,'GET',undefined,{Range:range})).status,416);
  const head=await h.call('media/'+m.id,'HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
  await login(h);await h.call('gallery/'+published.id,'PUT',{...gallery,published:false});h.anon();assert.equal((await h.call('media/'+m.id)).status,404);
 }finally{await h.close();}
});

test('booking injection, malformed dates, replay conflicts and private details are rejected',async()=>{
 const h=await harness();try {
  const b={name:'<script>alert(1)</script>',phone:'03001234567',email:'',serviceId:'bridal',date:new Date(Date.now()+3*864e5).toISOString().slice(0,10),time:'14:00',notes:'test',consent:true,requestId:crypto.randomUUID()};
  assert.equal((await h.call('bookings','POST',{...b,serviceId:{$ne:null}})).status,400);
  assert.equal((await h.call('bookings','POST',{...b,serviceId:"bridal' OR 1=1 --"})).status,400);
  assert.equal((await h.call('bookings','POST',{...b,date:'2027-02-30'})).status,400);
  assert.equal((await h.call('bookings','POST',{...b,website:'bot'})).status,400);
  const response=await h.call('bookings','POST',b);assert.equal(response.status,201);assert.deepEqual(Object.keys(await response.json()),['reference']);
  assert.equal((await h.call('bookings','POST',{...b,notes:'changed'})).status,409);
  assert.equal((await h.call('bookings/'+b.requestId)).status,401);
  const content=JSON.stringify(await(await h.call('content')).json());assert.ok(!content.includes(b.phone));assert.ok(!content.includes(b.requestId));
  await h.call('auth/setup','POST',account);
  const saved=await(await h.call('services','POST',{...service,id:'owner',kind:'admin',passwordHash:'evil',__proto__:{polluted:true}})).json();assert.notEqual(saved.id,'owner');assert.equal(saved.passwordHash,undefined);assert.equal({}.polluted,undefined);
  assert.equal((await h.call('settings','PUT',{...(await(await h.call('content')).json()).settings,instagram:'javascript:alert(1)'})).status,400);
 }finally{await h.close();}
});

test('portable password fallback computes the same standard PBKDF2 result',async()=>{
 const native=await passwordHash('test-password','test-salt',600000);
 const portable=Buffer.from(await pbkdf2Async(sha256,new TextEncoder().encode('test-password'),new TextEncoder().encode('test-salt'),{c:600000,dkLen:32})).toString('hex');
 assert.equal(native,portable);
});

test('real Express HTTP responses enforce browser headers, private routes and static boundaries',async()=>{
 const h=await harness();let server;try {
  await writeFile(h.dir+'/index.html','<!doctype html><html><body>Test</body></html>');await writeFile(h.dir+'/.env','secret-marker');
  const app=createApp({store:h.store,files:h.files,env:h.env,clientDirectory:h.dir});server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const page=await fetch(base+'/admin');assert.equal(page.status,200);assert.equal(page.headers.get('x-powered-by'),null);assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');
  const csp=page.headers.get('content-security-policy');assert.match(csp,/script-src 'self';/);assert.ok(!csp.includes('unsafe-eval'));assert.match(csp,/object-src 'none'/);assert.equal(page.headers.get('x-content-type-options'),'nosniff');
  for(const path of ['/.env','/server/index.mjs','/pnpm-lock.yaml','/main.js.map']) assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/api/admin',{headers:{'CF-Connecting-IP':'1.1.1.1'}})).status,401);
  assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(account)})).status,403);
  assert.throws(()=>createApp({store:h.store,files:h.files,env:{...h.env,TRUST_PROXY:'1'}}),/TRUST_PROXY/);
  const outside=h.dir+'/outside.txt';await writeFile(outside,'outside-secret');await mkdir(h.dir+'/salon',{recursive:true});const key='salon/'+crypto.randomUUID();await symlink(outside,h.dir+'/'+key);assert.equal(await h.files.get(key),null);
  await assert.rejects(localFiles(h.dir).get('../outside.txt'),/Invalid file key/);
 }finally{if(server)await new Promise(r=>server.close(r));await h.close();}
});
