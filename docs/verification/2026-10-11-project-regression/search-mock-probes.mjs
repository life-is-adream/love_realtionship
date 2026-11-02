import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo=String.raw`E:\一门给年轻人的恋爱成长课\relationship-simulator`;
const outputDir=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const actualOutputDir=path.dirname((await import('node:url')).fileURLToPath(import.meta.url));
const records=[];
let serial=0;
async function fixture(overrides={}) {
  const dir=await mkdtemp(path.join(actualOutputDir,'fixture-'));
  for(const file of ['http.js','upstream-request.js','searchProxy.js']) await writeFile(path.join(dir,file),await readFile(path.join(repo,'server',file)));
  await writeFile(path.join(dir,'package.json'),' {"type":"module"}');
  const cfg={PORT:3000,LLM_API_KEY:'synthetic-key',LLM_ENDPOINT:'https://offline.invalid/v1/responses',LLM_API_MODE:'responses',SEARCH_MODEL:'offline-model',SEARCH_ALLOWED_DOMAINS:['apa.org'],SEARCH_ALLOWED_DOMAINS_EXPLICIT:false,SEARCH_API_KEY:'',SEARCH_ENABLED:false,SEARCH_ENDPOINT:'',...overrides};
  await writeFile(path.join(dir,'config.js'),Object.entries(cfg).map(([k,v])=>`export const ${k}=${JSON.stringify(v)};`).join('\n'));
  return import(pathToFileURL(path.join(dir,'searchProxy.js')).href);
}
function reqWith(body){const req=Object.assign(new PassThrough(),{socket:{remoteAddress:'127.0.0.1'},headers:{}});queueMicrotask(()=>req.end(JSON.stringify(body)));return req;}
function response(){return Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,status:null,payload:null,writeHead(status){this.status=status;},end(body){this.payload=JSON.parse(body);this.writableEnded=true;}});}
const oldFetch=globalThis.fetch,oldLog=console.log;
let lastPayload,logs=[];
console.log=(message)=>logs.push(String(message));
function upstream(json,status=200){return {status,ok:status>=200&&status<300,text:async()=>JSON.stringify(json)};}
function mock(json,status=200){globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).hostname,'offline.invalid');lastPayload=JSON.parse(options.body);return upstream(json,status);};}
try {
  const model=await fixture();
  const citation=(url)=>({type:'url_citation',url,title:'synthetic-title',summary:'synthetic-summary'});
  mock({choices:[{message:{annotations:[citation('https://random-blog.invalid/advice'),citation('javascript:void(0)'),citation('data:text/html,synthetic')],content:'synthetic-summary'}}]});
  const res=response();await model.handleSearch(reqWith({query:'公开沟通研究'}),res);
  assert.equal(res.status,200);assert.equal(res.payload.filtered,0);assert.equal(res.payload.results.length,3);
  records.push({case:'implicit-whitelist-and-scheme',status:res.status,acceptedUrls:res.payload.results.map(x=>x.url),filtered:res.payload.filtered,requestShape:{messages:Array.isArray(lastPayload.messages),input:'input' in lastPayload,toolType:lastPayload.tools?.[0]?.type},passes:true});
  const renderer=await import(pathToFileURL(path.join(repo,'public/modules/render/coach-float-search.js')).href);
  const target={innerHTML:''};await renderer.runCoachFloatSearch({target,search:async()=>res.payload});
  assert.match(target.innerHTML,/权威来源 3 条/);assert.match(target.innerHTML,/href="javascript:void\(0\)"/);
  records.push({case:'render-label-and-unsafe-url',authorityLabel:true,unsafeSchemeAnchor:true,passes:true});
  const allowed=await fixture({SEARCH_ALLOWED_DOMAINS_EXPLICIT:true});
  mock({choices:[{message:{annotations:[citation('https://random-blog.invalid/advice')],content:'synthetic-unverified-summary'}}]});
  const filteredRes=response();await allowed.handleSearch(reqWith({query:'公开沟通研究'}),filteredRes);
  assert.equal(filteredRes.payload.results.length,0);assert.equal(filteredRes.payload.filtered,1);assert.equal(filteredRes.payload.note,'synthetic-unverified-summary');
  records.push({case:'filtered-source-summary-fallback',filtered:1,unverifiedSummaryStillReturned:true,passes:true});
  mock({output:[{type:'message',content:[{type:'output_text',text:'synthetic-summary',annotations:[citation('https://apa.org/relationships')]}]}]});
  const responsesRes=response();await model.handleSearch(reqWith({query:'公开沟通研究'}),responsesRes);assert.equal(responsesRes.status,200);assert.deepEqual(responsesRes.payload.results,[]);assert.equal(responsesRes.payload.note,'');
  records.push({case:'responses-mode-adapter',status:responsesRes.status,modelRequestAlwaysMessages:true,responseOutputIgnored:true,passes:true});
  mock({error:{message:'Param Incorrect',param:'webSearchEnabled is false'}},400);
  const pluginRes=response();await model.handleSearch(reqWith({query:'公开沟通研究'}),pluginRes);assert.equal(pluginRes.status,503);assert.equal(pluginRes.payload.error,'search_plugin_disabled');
  records.push({case:'plugin-disabled-controlled-error',status:503,passes:true});
  const noKey=await fixture({LLM_API_KEY:''});let calls=0;globalThis.fetch=async()=>{calls++;throw Error('should not call');};const noKeyRes=response();await noKey.handleSearch(reqWith({query:'公开沟通研究'}),noKeyRes);assert.equal(noKeyRes.status,503);assert.equal(calls,0);records.push({case:'no-key-no-dispatch',status:503,networkCalls:0,passes:true});
  let signal,started;const ready=new Promise(resolve=>started=resolve);globalThis.fetch=async(_url,options)=>{signal=options.signal;return {status:200,ok:true,text(){started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};};
  const closed=response();const task=model.handleSearch(reqWith({query:'公开沟通研究'}),closed);await ready;closed.destroyed=true;closed.emit('close');await task;assert.equal(signal.aborted,true);assert.equal(closed.status,null);assert.equal(closed.listenerCount('close'),0);records.push({case:'model-body-disconnect',aborted:true,writes:0,listeners:0,passes:true});
  let finishFirst,finishSecond;const staleTarget={innerHTML:''};const result=(name)=>({results:[{title:name,url:'https://apa.org/'+name,snippet:''}],filtered:0});
  const first=renderer.runCoachFloatSearch({target:staleTarget,stage:'阶段 A',search:()=>new Promise(resolve=>finishFirst=resolve)});
  const second=renderer.runCoachFloatSearch({target:staleTarget,stage:'阶段 B',search:()=>new Promise(resolve=>finishSecond=resolve)});
  finishSecond(result('latest'));await second;assert.match(staleTarget.innerHTML,/latest/);finishFirst(result('stale'));await first;assert.match(staleTarget.innerHTML,/stale/);assert.doesNotMatch(staleTarget.innerHTML,/latest/);
  records.push({case:'search-overlap-overwrites-latest',staleResponseWins:true,passes:true});
} finally {globalThis.fetch=oldFetch;console.log=oldLog;}
await writeFile(path.join(actualOutputDir,'review-results.json'),JSON.stringify({date:'2026-10-11',timezone:'Asia/Shanghai',realUpstreamCalls:0,readEnv:false,records},null,2));
console.log(JSON.stringify({outputDir:actualOutputDir,checkCount:records.length,records},null,2));
