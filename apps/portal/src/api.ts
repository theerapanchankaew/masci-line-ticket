import {isPreview,previewApi} from './preview';
export const apiBase=(import.meta.env.VITE_API_BASE_URL??'').replace(/\/$/,'');
export class RequestError extends Error{constructor(message:string,public status=0){super(message)}}
export async function api<T>(path:string,options?:RequestInit):Promise<T>{
 if(isPreview)return previewApi<T>(path,options);
 try{
  const r=await fetch(apiBase+path,{...options,credentials:'include',signal:AbortSignal.timeout(20000),headers:{...(options?.body instanceof FormData?{}:{'content-type':'application/json'}),...(import.meta.env.DEV?{'x-dev-staff-id':localStorage.getItem('masci-dev-staff')??'demo-admin'}:{}),...options?.headers}});
  if(!r.headers.get('content-type')?.includes('application/json'))throw new RequestError('API ยังไม่พร้อม หรือ session หมดอายุ กรุณาเปิด Worker และเข้าสู่ระบบผ่าน Cloudflare Access',r.status);
  const body=await r.json();if(!r.ok)throw new RequestError(body.error??`Request failed (${r.status})`,r.status);return body.data;
 }catch(e){if(e instanceof RequestError)throw e;throw new RequestError('เชื่อมต่อ API ไม่สำเร็จ/หมดเวลา กรุณาตรวจ Worker และเครือข่าย');}
}
export const post=<T,>(path:string,body:unknown,headers?:Record<string,string>)=>api<T>(path,{method:'POST',body:JSON.stringify(body),headers});
