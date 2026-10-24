import assert from 'node:assert/strict';
/** Opt-in, isolated manufacturer-copy journey; run under test/with-api.mjs. */
import {copyFileSync,constants,readFileSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {createInterface} from 'node:readline';
const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'..'),root=process.env.SSE_TEST_CASE_DIR;
assert(root&&process.env.SSE_TEST_CASE_DIR&&process.env.SSE_API_URL&&process.env.SSE_KNOWLEDGE_SOURCE_FILE);
assert.equal(process.platform,'win32','The live knowledge journey requires Windows.');
const relation=relative(realpathSync(repo),realpathSync(root));
assert(relation.startsWith('..'+sep)||isAbsolute(relation),'Live cases and reports must remain outside the public checkout.');
const {callApiOperationEnvelope,readApiHealthz}=await import(pathToFileURL(join(repo,'dist/api-client.js')).href);
const client={baseUrl:process.env.SSE_API_URL};const apiIdentity=await readApiHealthz(client);client.expectedInstanceId=apiIdentity.instanceId;
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const original=process.env.SSE_KNOWLEDGE_SOURCE_FILE,originalHash=sha(original),fixture=join(process.env.SSE_TEST_CASE_DIR,'owned-knowledge.ESt2025');
copyFileSync(original,fixture,constants.COPYFILE_EXCL);
const reportPath=join(root,'tax-knowledge-report.json');assert(!existsSync(reportPath));
const report={schemaVersion:1,scope:'opt-in API/MCP journey with an own job-bound helper; API identity and local helper sources are recorded separately',startedAt:new Date().toISOString(),source:original,sourceHash:originalHash,fixture,calls:[],outcome:'running'};
report.apiIdentity=apiIdentity;report.nodeVersion=process.version;
report.sourceFiles=Object.fromEntries(['powershell/sse-worker.ps1','powershell/tax-knowledge.ps1','powershell/sse-native.cs','powershell/sse-native.dll','dist/api-client.js','dist/index.js'].map(file=>[file,sha(join(repo,file))]));
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
const ps=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
function inspect(mode,identityFile){
 const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(here,'knowledge-helper.ps1'),'-Mode',mode];
 if(identityFile)args.push('-IdentityFile',identityFile);
 const result=spawnSync(ps,args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
 assert(!result.error&&result.status===0,`Identity/cleanup probe ${mode}: ${result.error?.message??result.stderr}`);
 return JSON.parse(result.stdout.trim());
}
let owner,helper,helperFile,job,mcp,mcpTransport,jobReader,jobExit,jobEnded=false,closeAttempted=false,helperCloseAttempted=false,primary;
const replies=[],waiters=[];
function nextReply(){
 if(replies.length)return Promise.resolve(replies.shift());
 if(jobEnded)return Promise.reject(new Error('Owned job manager already exited.'));
 return new Promise((resolve,reject)=>{
  const waiter={resolve:v=>{clearTimeout(waiter.timer);resolve(v)},reject:e=>{clearTimeout(waiter.timer);reject(e)}};
  waiter.timer=setTimeout(()=>{const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);waiter.reject(new Error('Owned job reply timed out; no command replay.'));},20000);
  waiters.push(waiter);
 });
}
async function jobRequest(request){const response=nextReply();job.stdin.write(JSON.stringify(request)+'\n');const result=await response;assert.equal(result.ok,true,JSON.stringify(result));return result;}
async function call(operation,args={},expectedOk=true,timeout=120000){
 const started=performance.now();const result=(await callApiOperationEnvelope(operation,args,timeout,client)).result;
 report.calls.push({transport:'api',operation,args,result,elapsedMs:performance.now()-started});save();
 if(operation==='launch'&&Number.isInteger(result.pid)&&result.pid>0&&result.processStillRunning!==false)owner={pid:result.pid,hwnd:result.instance?.hwnd??result.hwnd};
 assert.equal(result.ok,expectedOk,JSON.stringify(result));return result;
}
async function closeSse(){closeAttempted=true;const result=await call('close',{...owner,discardChanges:true});assert.equal(result.stillRunning,false);assert.notEqual(result.killed,true);report.sseClose=result;owner=undefined;save();}
try{
 report.before=inspect('census');assert.deepEqual(report.before,[]);save();
 await call('launch',{caseRef:'cases:owned-knowledge.ESt2025',mode:'normal'},true,240000);
 const processes=inspect('census');const sse=processes.find(p=>p.pid===owner.pid&&p.hwnd===owner.hwnd);assert(sse);
 report.ownSse=sse;const rootIdentity=join(root,'owned-sse.json');writeFileSync(rootIdentity,JSON.stringify(sse,null,2)+'\n',{flag:'wx'});save();
 job=spawn(ps,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(here,'owned-sse-job.ps1'),'-IdentityFile',rootIdentity],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 jobExit=new Promise(resolve=>job.once('exit',(...result)=>{jobEnded=true;for(const w of waiters.splice(0))w.reject(new Error('Owned job manager exited.'));resolve(result)}));
 job.on('error',error=>{jobEnded=true;for(const w of waiters.splice(0))w.reject(error)});
 jobReader=createInterface({input:job.stdout});
 jobReader.on('line',line=>{let value;try{value=JSON.parse(line)}catch(error){for(const w of waiters.splice(0))w.reject(error);return}const waiter=waiters.shift();waiter?waiter.resolve(value):replies.push(value);});
 let jobStderr='';job.stderr.on('data',chunk=>{jobStderr+=chunk;if(jobStderr.length>65536)jobStderr=jobStderr.slice(-65536)});
 report.jobReady=await nextReply();assert.equal(report.jobReady.ok,true,JSON.stringify(report.jobReady));save();
 await call('click',{hwnd:owner.hwnd,name:'Steuerwissen'});
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){const current=inspect('census');const candidates=current.filter(p=>p.title==='Steuerwissen');if(candidates.length===1){helper=candidates[0];break}await new Promise(r=>setTimeout(r,250));}
 assert(helper,'One exact helper must open.');
 const membership=await jobRequest({op:'member',identity:helper});assert.equal(membership.member,true,'The helper must belong to the own SSE job, including bootstrap descendants.');
 helper.ownershipProved=true;helper.ownershipKind='verified-windows-job';helper.membership=membership;
 helperFile=join(root,'owned-helper.json');writeFileSync(helperFile,JSON.stringify(helper,null,2)+'\n',{flag:'wx'});report.helper=helper;save();
 const wrong=await call('tax_knowledge_search',{fenster:owner.hwnd,begriff:'Arbeitszimmer'},false);assert.equal(wrong.kind,'not-found');
 const positive=await call('tax_knowledge_search',{fenster:helper.hwnd,begriff:'Reverse-Charge',mindestLaenge:20,maxAbschnitte:6});
 assert.equal(positive.trefferAnzahl,1);assert(positive.abschnitte.length>0);assert.equal(positive.pid,helper.pid);
 assert.equal(positive.fenster,helper.hwnd);
 const repeated=await call('tax_knowledge_search',{fenster:helper.hwnd,begriff:'Reverse-Charge',mindestLaenge:20,maxAbschnitte:6});
 assert.equal(repeated.pid,helper.pid);assert.equal(repeated.fenster,helper.hwnd);
 assert.equal(repeated.trefferAnzahl,positive.trefferAnzahl);assert.deepEqual(repeated.abschnitte,positive.abschnitte);assert.deepEqual(repeated.verweise,positive.verweise);

 mcp=new Client({name:'owned-knowledge-acceptance',version:'1.0.0'});
 mcpTransport=new StdioClientTransport({command:process.execPath,args:[join(repo,'dist/index.js')],env:{...process.env}});
 await mcp.connect(mcpTransport);
 async function searchMcp(args){
  const started=performance.now();
  const response=await mcp.callTool({name:'sse_tax_knowledge_search',arguments:args},undefined,{timeout:120000,maxTotalTimeout:120000});
  const result=response.structuredContent;
  report.calls.push({transport:'mcp',operation:'tax_knowledge_search',args,result,elapsedMs:performance.now()-started});save();
  assert.notEqual(response.isError,true,JSON.stringify(result));assert(result&&typeof result==='object','MCP must return the complete structured result.');
  assert.equal(result.ok,true);assert.equal(result.pid,helper.pid);assert.equal(result.fenster,helper.hwnd);return result;
 }
 const args={fenster:helper.hwnd,begriff:'Arbeitszimmer',mindestLaenge:20,maxAbschnitte:6};
 const result=await searchMcp(args);assert(result.trefferAnzahl>0);assert(result.abschnitte.length>0);
 const repeatedMcp=await searchMcp(args);
 assert.equal(repeatedMcp.trefferAnzahl,result.trefferAnzahl);assert.deepEqual(repeatedMcp.abschnitte,result.abschnitte);assert.deepEqual(repeatedMcp.verweise,result.verweise);
 const empty=await call('tax_knowledge_search',{fenster:helper.hwnd,begriff:'ssepruefungohnetrefferxyz'});
 assert.equal(empty.trefferAnzahl,0);assert.deepEqual(empty.abschnitte,[]);assert.equal(empty.pid,helper.pid);assert.equal(empty.fenster,helper.hwnd);
 const repeatedEmpty=await searchMcp({fenster:helper.hwnd,begriff:'ssepruefungohnetrefferxyz'});
 assert.equal(repeatedEmpty.trefferAnzahl,0);assert.deepEqual(repeatedEmpty.abschnitte,[]);
 const afterEmpty=await call('tax_knowledge_search',{fenster:helper.hwnd,begriff:'Reverse-Charge',mindestLaenge:20,maxAbschnitte:6});
 assert.equal(afterEmpty.pid,helper.pid);assert.equal(afterEmpty.fenster,helper.hwnd);
 assert.equal(afterEmpty.trefferAnzahl,positive.trefferAnzahl);assert.deepEqual(afterEmpty.abschnitte,positive.abschnitte);assert.deepEqual(afterEmpty.verweise,positive.verweise);
 report.outcome='passed';
}catch(error){primary=error;report.outcome='failed';report.failure=String(error.stack??error);}
finally{
 const failures=[];
 if(mcp){try{await mcp.close()}catch(error){failures.push(error)}}
 if(helper?.ownershipProved&&!helperCloseAttempted){helperCloseAttempted=true;try{assert.equal((await jobRequest({op:'member',identity:helper})).member,true);report.helperClose=inspect('close',helperFile);}catch(error){failures.push(error)}}
 if(owner&&!closeAttempted){try{await closeSse()}catch(error){failures.push(error)}}
 if(job&&!jobEnded){try{report.jobAfter=await jobRequest({op:'counts'});assert.equal(report.jobAfter.active,0);report.jobFinish=await jobRequest({op:'finish'});}catch(error){failures.push(error)}job.stdin.end();
  let exitTimer;
  try{const code=await Promise.race([jobExit,new Promise((_,reject)=>{exitTimer=setTimeout(()=>reject(new Error('Owned job manager did not exit.')),10000)})]);assert.equal(code[0],0);}catch(error){failures.push(error)}finally{clearTimeout(exitTimer)}
 }
 if(jobReader)jobReader.close();
 report.after=inspect('census');report.sourceUnchanged=sha(original)===originalHash;report.copyUnchanged=sha(fixture)===originalHash;
 report.cleanupFailures=failures.map(e=>String(e.stack??e));report.ownerUnresolved=Boolean(owner);report.finishedAt=new Date().toISOString();
 if(failures.length||report.after.length||!report.sourceUnchanged||!report.copyUnchanged){primary=new AggregateError([...(primary?[primary]:[]),...failures],'Owned knowledge cleanup or integrity failed.');report.outcome='failed';}
 save();
}
if(primary)throw primary;
process.stdout.write('Own job-bound knowledge helper: API/MCP positive and repeated search, repeated no hits, result transitions, wrong window, unchanged cases and normal zero-process cleanup passed.\n');
