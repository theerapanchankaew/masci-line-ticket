import {copyFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),target=resolve(root,'apps/worker/.dev.vars');
try{await access(target);}catch{await copyFile(resolve(root,'apps/worker/.dev.vars.example'),target);console.log('Created local demo environment (no live credentials).');}
for(const command of ['db:local','db:demo']){const result=spawnSync(process.platform==='win32'?'pnpm.cmd':'pnpm',['--filter','@masci/worker',command],{cwd:root,shell:process.platform==='win32',stdio:'inherit',env:{...process.env,CI:'1'}});if(result.status!==0)process.exit(result.status??1);}
console.log('Local setup ready. Run pnpm dev and open http://localhost:5173');
