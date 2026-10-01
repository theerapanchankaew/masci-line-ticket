import {createRemoteJWKSet,jwtVerify} from 'jose';
import type {MiddlewareHandler} from 'hono';
import type {AppEnv} from '../types';
let remote:ReturnType<typeof createRemoteJWKSet>|undefined;
const auth:MiddlewareHandler<AppEnv> = async(c,next)=>{
 let email:string|undefined;
 const local=c.req.header('x-dev-staff-id'),host=c.req.header('host')??'';
 if(c.env.ENVIRONMENT==='development'&&c.env.DEV_AUTH_ENABLED==='true'&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))email=(local||c.env.DEV_STAFF_ID||'demo-admin')+'@masci.local';
 else{
  const jwt=c.req.header('cf-access-jwt-assertion');
  if(!jwt||!c.env.ACCESS_TEAM_DOMAIN||!c.env.ACCESS_AUD)return c.json({error:'Sign in through organization access is required'},401);
  try{remote??=createRemoteJWKSet(new URL(`https://${c.env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));const {payload}=await jwtVerify(jwt,remote,{issuer:`https://${c.env.ACCESS_TEAM_DOMAIN}`,audience:c.env.ACCESS_AUD});email=typeof payload.email==='string'?payload.email:undefined;}catch{return c.json({error:'Invalid or expired access session'},401);}
 }
 if(!email)return c.json({error:'Identity email is missing'},401);
 const actor=await c.env.DB.prepare('SELECT * FROM staff WHERE email=? COLLATE NOCASE AND active=1').bind(email).first<any>();
 if(!actor)return c.json({error:'Your MASCI Ticket account is inactive or not provisioned'},403);
 c.set('actor',actor);await next();
};
export default auth;
