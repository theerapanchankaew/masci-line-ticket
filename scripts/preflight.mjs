import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const config=JSON.parse(readFileSync(resolve(import.meta.dirname,'../apps/worker/wrangler.jsonc'),'utf8'));
const env=config.env.production,issues=[];
for(const [key,value] of Object.entries(env.vars))if(typeof value==='string'&&(/REPLACE|example\.org/.test(value)))issues.push(`${key} still contains placeholder`);
for(const d of env.d1_databases)if(!/^[0-9a-f-]{36}$/i.test(d.database_id)||d.database_id==='00000000-0000-0000-0000-000000000000')issues.push('Production D1 database_id not configured');
if(env.vars.DEV_AUTH_ENABLED!=='false'||env.vars.ENVIRONMENT!=='production')issues.push('Production authentication flags are unsafe');
if(issues.length){console.error(issues.join('\n'));process.exit(1);}
console.log('Committed production configuration passed. Confirm Cloudflare secrets, Access policy, resources, migrations, L Harness integration and staging acceptance separately.');
