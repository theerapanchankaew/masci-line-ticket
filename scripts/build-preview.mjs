import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const dist=resolve(root,'apps/portal/dist');
let html=await readFile(resolve(dist,'index.html'),'utf8');
const js=html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/)?.[1];
const css=html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/)?.[1];
if(!js||!css)throw new Error('Build Portal before creating Preview');
const code=await readFile(resolve(dist,js.replace(/^\//,'')),'utf8');
const style=await readFile(resolve(dist,css.replace(/^\//,'')),'utf8');
html=html.replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/,()=>`<script>window.__MASCI_PREVIEW__=true;</script><script type="module">${code.replace(/<\/script/gi,'<\\/script')}</script>`);
html=html.replace(/<link[^>]+href="[^"]+\.css"[^>]*>/,()=>`<style>${style}</style>`);
await writeFile(resolve(root,'preview.html'),html);
console.log('Created preview.html — standalone, read-only sample data');
