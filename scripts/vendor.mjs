import {cp,mkdir,rm} from 'node:fs/promises';
const root='src/vendor';await rm(root,{recursive:true,force:true});await mkdir(root+'/mermaid/chunks',{recursive:true});
await cp('node_modules/mermaid/dist/mermaid.esm.min.mjs',root+'/mermaid/mermaid.mjs');
await cp('node_modules/mermaid/dist/chunks/mermaid.esm.min',root+'/mermaid/chunks/mermaid.esm.min',{recursive:true,filter:path=>!path.endsWith('.map')});
await cp('node_modules/dompurify/dist/purify.es.mjs',root+'/purify.mjs');
await cp('node_modules/marked/lib/marked.esm.js',root+'/marked.mjs');
for(const name of ['mermaid','dompurify','marked'])await cp('node_modules/'+name+'/LICENSE',root+'/'+name+'-LICENSE');
