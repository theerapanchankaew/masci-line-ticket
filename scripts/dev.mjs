import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),children=[];
let ending=false;function stop(code=0){if(ending)return;ending=true;for(const child of children)child.kill('SIGTERM');process.exitCode=code;}
for(const name of ['@masci/worker','@masci/portal']){const child=spawn(process.platform==='win32'?'pnpm.cmd':'pnpm',['--filter',name,'dev'],{cwd:root,shell:process.platform==='win32',stdio:'inherit'});children.push(child);child.on('error',e=>{console.error(e.message);stop(1);});child.on('exit',code=>stop(code??0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
