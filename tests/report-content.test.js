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
test('Markdown block and inline features share one parser, preserving plain line breaks',()=>{
 const html=reportHTML('# 見出し\n\n段落 **太字** *斜体* `inline <code>`\n次の行\n\n- 項目\n  - 子項目\n\n1. 一番\n2. 二番\n\n> 引用\n\n|項目|値|\n|---|---|\n|名前|説明|\n\n[リンク](https://example.com/path "説明")');
 for(const tag of ['h1','p','strong','em','code','ul','ol','blockquote','table','thead','tbody'])assert.match(html,new RegExp('<'+tag+'[ >]'));
 assert.match(html,/inline &lt;code&gt;/);assert.match(html,/次の行/);assert.match(html,/<br>/);assert.match(html,/href="https:\/\/example.com\/path"/);assert.match(html,/title="説明"/);
 assert.match(reportHTML('一行目\n二行目\n\n別段落'),/<p>一行目<br>\n二行目<\/p>\n<p>別段落<\/p>/);
});
test('HTML, dangerous URL schemes, attributes and external images cannot create executable content',()=>{
 const raw='<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<svg onload=alert(1)>\n<iframe srcdoc="<script>x</script>"></iframe>';
 const html=reportHTML(raw);assert(!/<(?:script|img|svg|iframe)\b/.test(html));assert.match(html,/&lt;script&gt;/);
 for(const url of ['javascript:alert(1)','jav&#x61;script:alert(1)','data:text/html,hi','file:///tmp/x','//evil.test/a','/admin','vbscript:x','https://user:pass@example.com'])assert(!reportHTML('[click]('+url+')').includes('<a '),url);
 for(const input of ['![x](//evil.test/x)','![x](data:image/png;base64,AAA)','![x][ref]\n\n[ref]: https://evil.test/x','<img src="/api/images/'+id+'">'])assert(!reportHTML(input).includes('<img'),input);
 assert(!reportHTML('[safe](https://example.com "\\\" onmouseover=alert(1)")').includes('" onmouseover='));
 assert.match(reportHTML('[artifact](/api/jobs/'+id+'/artifact?path=report.txt)'),/download/);
});
test('code remains escaped; streaming incomplete fences do not become diagrams or images',()=>{
 const code='```html\n<img src=x onerror=alert(1)>\n![x](village-image:'+id+')\n```';
 assert(!reportHTML(code).includes('<img'));assert.match(reportHTML(code),/<pre><code>&lt;img/);
 const partial='```mermaid\nflowchart LR\nA-->B';assert(!reportHTML(partial).includes('data-visual'));assert.match(reportHTML(partial),/A--&gt;B/);
 assert.match(reportHTML(partial+'\n```'),/data-visual="mermaid"/);
 assert.match(reportHTML('> ```mermaid\n> flowchart LR\n> A-->B\n> ```'),/data-visual="mermaid"/);
 assert(!reportHTML('````mermaid\nflowchart LR\nA-->B\n```').includes('data-visual'));
 assert.match(reportHTML('~~~mermaid\nflowchart LR\nA-->B\n~~~'),/data-visual="mermaid"/);
});

test('Japanese bare link punctuation stays outside the anchor',()=>{assert.match(reportHTML('https://example.com/test。'),/href="https:\/\/example.com\/test"/);assert.match(reportHTML('https://example.com/test。'),/<\/a>。/);});
