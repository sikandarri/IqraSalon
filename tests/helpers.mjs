import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleApi} from '../lib/salon/api.mjs';
import {d1Store} from '../lib/salon/d1-store.mjs';
import {localFiles} from '../server/local-files.mjs';
export const origin='http://localhost:3000';
export const account={email:'owner@example.com',password:'a-long-safe-password',setupToken:'a'.repeat(64)};
export async function harness(overrides={}){const dir=await mkdtemp(join(tmpdir(),'iqra-test-')),db=new DatabaseSync(join(dir,'db.sqlite'));db.exec('CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id));CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);');const binding={prepare(sql){let v=[];return{bind(...args){v=args;return this;},first:async()=>db.prepare(sql).get(...v)||null,all:async()=>({results:db.prepare(sql).all(...v)}),run:async()=>db.prepare(sql).run(...v)};}};const store=d1Store(binding),files=localFiles(dir),env={PUBLIC_ORIGIN:origin,SETUP_TOKEN:account.setupToken,AUTH_SECRET:'b'.repeat(64),CLIENT_IP:'test',...overrides};let cookie='';return {store,files,env,dir,db,cookie:()=>cookie,setCookie:v=>{cookie=v;},anon:()=>{cookie='';},close:async()=>{db.close();await rm(dir,{recursive:true,force:true});},async call(path,method='GET',data,extra={}){const headers={...(method!=='GET'?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(data instanceof FormData?{}:{'Content-Type':'application/json'}),...extra};const r=await handleApi(new Request(origin+'/api/'+path,{method,headers,...(data===undefined?{}:{body:data instanceof FormData?data:JSON.stringify(data)})}),{store,files,env});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;}};}
