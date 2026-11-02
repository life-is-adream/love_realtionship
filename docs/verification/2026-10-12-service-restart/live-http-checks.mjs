import http from 'node:http';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let requests=0;
const checks=[];
async function call(body,route='/api/relationship-intelligence') {
  requests++;
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:3000,path:route,method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});
    req.setTimeout(5000,()=>req.destroy(new Error('local verification timeout')));req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();
  });
}
function record(name,r,predicate){assert.ok(predicate(r),name);checks.push({name,status:r.status,passed:true});}
const health=await call(undefined,'/api/health');record('health identity',health,r=>r.status===200&&r.data.ok===true&&r.data.service==='heartflow');
let r=await call({messages:[{type:'her',text:'我不想继续，请别再联系我。'}],signals:{counterOffer:true,concreteDatePlan:true}});record('explicit no-contact overrides stale plan',r,r=>r.status===200&&r.data.decision.value==='EXIT'&&r.data.state.to==='EXIT');
r=await call({messages:[{type:'her',text:'今天不要联系我。'}],signals:{concreteDatePlan:true}});record('temporary pause is not permanent exit',r,r=>r.status===200&&r.data.decision.value==='DE_ESCALATE'&&r.data.state.to!=='EXIT');
const base={messages:[{type:'her',text:'一条合成观察'}],consent:true,caseId:'case_live_restart'};
r=await call({...base,goal:'example-person@example.invalid',memory:{observations:[{id:'example-person@example.invalid',summary:'普通观察',evidenceIds:['example-person@example.invalid']}],outcomes:[{id:'outcome_live',prediction:'预测',observedOutcome:'结果',update:'Wechat ID: synthetic_contact',lessons:['姓名: 合成私密样例']}]}});
record('memory and goal sanitize every known field',r,r=>{const text=JSON.stringify(r.data);return r.status===200&&!text.includes('example-person@example.invalid')&&!text.includes('synthetic_contact')&&!text.includes('合成私密样例')&&r.data.memoryPatch.privacy.anonymized===false&&r.data.memoryPatch.privacy.knownIdentifiersRedacted===true&&r.data.memoryPatch.privacy.manualReviewRequired===true&&r.data.memoryPatch.privacy.thirdPartyIdentifiers===null;});
const first=await call(base);record('first consented observation',first,r=>r.status===200&&r.data.memoryPatch.observations.length===1);
const secondInput={...base,messages:[{type:'her',text:'另一条合成观察'}],memory:first.data.memoryPatch};const second=await call(secondInput);record('new content preserves observation',second,r=>r.status===200&&r.data.memoryPatch.observations.length===2);
const repeat=await call({...secondInput,memory:second.data.memoryPatch});record('same request retry is idempotent',repeat,r=>r.status===200&&r.data.memoryPatch.observations.length===2&&r.data.state.changed===false);
const newSignalInput={...secondInput,memory:repeat.data.memoryPatch,signals:{concreteDatePlan:true}};const signal=await call(newSignalInput);record('new signals keep new decision summary',signal,r=>r.status===200&&r.data.decision.value==='ADVANCE'&&r.data.memoryPatch.observations.length===3&&r.data.memoryPatch.observations.at(-1).summary.includes('ADVANCE'));
const signalRepeat=await call({...newSignalInput,memory:signal.data.memoryPatch});record('new signal retry remains idempotent',signalRepeat,r=>r.status===200&&r.data.memoryPatch.observations.length===3&&r.data.state.changed===false);
r=await call({...base,consent:false,memory:signalRepeat.data.memoryPatch});record('no consent produces no memory patch',r,r=>r.status===200&&r.data.memoryPatch===null);
r=await call({messages:[]});record('empty input is controlled 400',r,r=>r.status===400&&r.data.error==='messages_required');
r=await call({...base,caseId:'example-person@example.invalid'});record('non-anonymous case identifier is controlled 400',r,r=>r.status===400&&r.data.error==='invalid_case_id');
const result={date:'2026-10-12',timezone:'Asia/Shanghai',httpRequests:requests,passed:checks.length,failed:0,realModelCalls:0,realSearchCalls:0,checks};
const output=path.join(os.tmpdir(),'heartflow-restart-20261012-live-results.json');await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
