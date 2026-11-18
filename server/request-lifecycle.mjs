import {applyGraph,graphResults,rootNode} from './unified-requests.mjs';
export const requestStatus=q=>q.integrity?'quarantined':({withdrawn:'cancelled',completed:'completed'})[rootNode(q).state.kind]||'active';
export const resultEntries=(data,q)=>q.integrity?[]:graphResults(data,q);
export const observeRequest=(data,q)=>applyGraph(data,q,{type:'observe',actor:'program'});
