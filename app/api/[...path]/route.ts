import {env} from 'cloudflare:workers';
import {handleApi} from '@/lib/salon/api.mjs';
import {d1Store,r2Files} from '@/lib/salon/d1-store.mjs';
export const dynamic='force-dynamic';
const handler=(request:Request)=>handleApi(request,{store:d1Store((env as any).DB),files:r2Files((env as any).BUCKET),env:{SETUP_TOKEN:(env as any).SETUP_TOKEN,AUTH_SECRET:(env as any).AUTH_SECRET,PUBLIC_ORIGIN:(env as any).PUBLIC_ORIGIN,CLIENT_IP:request.headers.get('cf-connecting-ip')||'unknown',RUNTIME_KIND:'sites'}});
export const GET=handler;export const POST=handler;export const PUT=handler;export const PATCH=handler;export const DELETE=handler;export const HEAD=handler;
