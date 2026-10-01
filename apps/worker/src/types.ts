import type{Staff}from'@masci/contracts';
export interface Bindings{DB:D1Database;EVIDENCE:R2Bucket;JOBS?:Queue;ENVIRONMENT:string;DEV_AUTH_ENABLED?:string;DEV_STAFF_ID?:string;ALLOWED_ORIGIN:string;PORTAL_URL:string;ACCESS_TEAM_DOMAIN?:string;ACCESS_AUD?:string;LINE_ACCOUNT_KEY:string;INTEGRATION_SECRET?:string;JOB_SECRET?:string;RETENTION_DAYS?:string;L_HARNESS_URL:string;L_HARNESS_API_KEY?:string;L_HARNESS_ACCOUNT_ID?:string;EMAIL_API_KEY?:string;EMAIL_FROM?:string}
export type AppEnv={Bindings:Bindings;Variables:{actor:Staff}};
export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
