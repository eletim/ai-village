import {test} from 'node:test';import assert from 'node:assert/strict';
import {reportHTML,reportImageURL,safeDiagram} from '../src/report-content.js';
const id='11111111-2222-4333-8444-555555555555';
test('only saved UUID images and closed safe Mermaid fences become visuals',()=>{
 assert.equal(reportImageURL('village-image:'+id),'/api/images/'+id);
 for(const url of ['https://evil.test/x.png','javascript:alert(1)','data:image/svg+xml,<svg/>','file:/etc/passwd','/api/images/'+id,'village-image:../../secret']){assert.equal(reportImageURL(url),null);assert(!reportHTML('![x]('+url+')').includes('<img'));}
 assert.match(reportHTML('before\n```mermaid\nflowchart LR\n A-->B\n```\nafter'),/data-visual="mermaid"/);
 assert(!reportHTML('```mermaid\nflowchart LR\n A-->').includes('data-visual'));
 assert(!reportHTML('```txt\n![image](village-image:'+id+')\n```').includes('<img'));
 assert(!reportHTML('`![report](village-image:'+id+')`').includes('<img'));
 assert.match(reportHTML('![report](village-image:'+id+')'),/data-visual="image"/);
 assert.match(reportHTML('https://example.com\n<script>alert(1)</script>'),/rel="noopener noreferrer"/);assert(!reportHTML('<script>x</script>').includes('<script>'));
 for(const code of ['%%{init: {securityLevel: "loose"}}%%\nflowchart LR','---\nconfig: x','flowchart LR\nclassDef x fill:url(https://evil.test)','flowchart LR\nA[<img src=x>]'])assert.equal(safeDiagram(code),false);
});
