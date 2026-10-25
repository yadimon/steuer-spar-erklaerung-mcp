import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createSseApiServer} from '../dist/api-server.js';
import {callApiOperation,readApiHealthz} from '../dist/api-client.js';
import {callApiOperationWithBusyRetry,callApiOperationWithBusyRetryEnvelope} from '../dist/api-busy-retry.js';
import {localHttpFetch} from '../dist/local-http-transport.js';
import {SSE_API_INSTANCE_HEADER} from '../dist/api-supervisor-contract.js';

let hold, entered, mode='success', writes=0;
const server=createSseApiServer({execute:async(operation,args)=>{
  if(operation==='health'&&hold){entered();await hold;return {ok:true,running:false};}
  writes++;
  if(mode==='worker-busy')return {ok:false,kind:'busy',error:'Synthetic worker busy',retryable:true,mutationStarted:false,resultingState:'unchanged'};
  if(mode==='unknown')return {ok:false,kind:'timeout',error:'Synthetic unknown outcome',outcomeUnknown:true};
  return {ok:true,ref:args.ref,bytes:Buffer.byteLength(args.text),sha256:'a'.repeat(64)};
}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const baseUrl=`http://127.0.0.1:${server.address().port}`;
const expectedInstanceId=(await readApiHealthz({baseUrl})).instanceId;
const args={ref:'results:synthetic.txt',text:'Original synthetic value'};
const pinned={baseUrl,expectedInstanceId};
const errorEnvelope=(code)=>({apiVersion:'v1',requestId:randomUUID(),error:{code,message:'Synthetic rejection'}});
async function blocked(test){
  let release, notify;hold=new Promise(resolve=>release=resolve);
  const started=new Promise(resolve=>notify=resolve);entered=notify;
  const active=callApiOperation('health',{},2000,pinned);await started;
  try{await test(async()=>{release();await active;});}
  finally{release();await active;hold=undefined;}
}
try{
  let attempts=0;const original=structuredClone(args);let priorBudget=2001;
  await blocked(async release=>{
    const result=await callApiOperationWithBusyRetryEnvelope('workspace_file_write_text',args,2000,{
      ...pinned,fetchImpl:async(url,init)=>{
        attempts++;assert.equal(init.headers[SSE_API_INSTANCE_HEADER],expectedInstanceId);
        const body=JSON.parse(init.body);
        assert.deepEqual(body.args,original);
        assert(body.timeoutMs<priorBudget&&body.timeoutMs<=2000,'Each attempt must send the decreasing shared budget.');
        priorBudget=body.timeoutMs;
        const response=await localHttpFetch(url,init);
        if(attempts===1)args.text='Changed by the caller while waiting';
        if(attempts===2)await release();
        return response;
      },
    },{delayMs:5});
    assert.equal(result.result.ok,true);
  });
  assert.equal(attempts,3);assert.equal(writes,1,'Busy rejection must not dispatch a duplicate write.');
  attempts=0;
  await blocked(async()=>{
    await assert.rejects(callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,{
      ...pinned,fetchImpl:async(...parameters)=>{attempts++;return localHttpFetch(...parameters);},
    },{delayMs:0}),error=>error.kind==='busy'&&error.httpStatus===409&&/3 Versuchen/u.test(error.message));
  });
  assert.equal(attempts,3);assert.equal(writes,1);

  for(const disposition of ['worker-busy','unknown']){
    mode=disposition;attempts=0;
    const result=await callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,{
      ...pinned,fetchImpl:async(...parameters)=>{attempts++;return localHttpFetch(...parameters);},
    },{delayMs:0});
    assert.equal(result.ok,false);assert.equal(attempts,1,'HTTP-200 worker failures must never be replayed.');
  }
  mode='success';
  for(const status of [400,500,503]){
    attempts=0;
    await assert.rejects(callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,{
      ...pinned,fetchImpl:async()=>{attempts++;return new Response(JSON.stringify(errorEnvelope('busy')),
        {status,headers:{'content-type':'application/json'}});},
    }),error=>error.kind==='busy'&&error.httpStatus===status&&error.operationResponseReceived===true);
    assert.equal(attempts,1,'A busy code without HTTP409 is not proof of non-dispatch.');
  }
  attempts=0;
  await assert.rejects(callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,{
    ...pinned,fetchImpl:async()=>{attempts++;throw Object.assign(new Error('Synthetic response stream reset'),{code:'ECONNRESET'});},
  }),error=>error.kind==='transport-unknown');
  assert.equal(attempts,1);
  attempts=0;
  await assert.rejects(callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,{
    ...pinned,fetchImpl:async()=>{attempts++;return new Response('{}',{status:409,headers:{'content-type':'application/json'}});},
  }),error=>error.kind==='protocol');
  assert.equal(attempts,1);

  attempts=0;const controller=new AbortController();
  await blocked(async()=>{
    await assert.rejects(callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,{
      ...pinned,signal:controller.signal,fetchImpl:async(...parameters)=>{
        attempts++;const response=await localHttpFetch(...parameters);setTimeout(()=>controller.abort(),20);return response;
      },
    },{delayMs:250}),error=>error.kind==='aborted');
  });
  assert.equal(attempts,1);
  attempts=0;
  await blocked(async()=>{
    await assert.rejects(callApiOperationWithBusyRetry('workspace_file_write_text',original,300,{
      ...pinned,fetchImpl:async(...parameters)=>{attempts++;return localHttpFetch(...parameters);},
    },{delayMs:250}),error=>error.kind==='busy-budget-exhausted');
  });
  assert.equal(attempts,1,'A retry may not replace the shared deadline with a fresh full budget.');
  for(const retry of [{maxAttempts:0},{maxAttempts:4},{maxAttempts:1.5},{delayMs:-1},{delayMs:5001}]){
    await assert.rejects(callApiOperationWithBusyRetry('health',{},2000,{...pinned,
      fetchImpl:async()=>assert.fail('Invalid retry policy dispatched a request.')},retry),error=>error.kind==='bad-args');
  }
  const alreadyAborted=new AbortController();alreadyAborted.abort();
  await assert.rejects(callApiOperationWithBusyRetry('health',{},2000,{baseUrl,signal:alreadyAborted.signal,
    fetchImpl:async()=>assert.fail('Aborted retry dispatched metadata or operation.')}),error=>error.kind==='aborted');

  attempts=0;
  await assert.rejects(callApiOperationWithBusyRetry('health',{},200,{
    baseUrl,fetchImpl:async(url,init)=>{
      attempts++;assert.match(String(url),/\/healthz$/u);
      await new Promise((resolve,reject)=>init.signal.addEventListener('abort',
        ()=>reject(Object.assign(new Error('Synthetic metadata abort'),{name:'AbortError'})),{once:true}));
      assert.fail('Metadata wait must abort.');
    },
  }),error=>error.kind==='not-dispatched');
  assert.equal(attempts,1,'Identity acquisition shares the deadline and cannot dispatch a write.');

  const writesBeforeMismatch=writes;
  attempts=0;
  await assert.rejects(callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,{
    baseUrl,expectedInstanceId:randomUUID(),fetchImpl:async(...parameters)=>{attempts++;return localHttpFetch(...parameters);},
  }),error=>error.kind==='api-instance-mismatch'&&error.httpStatus===409);
  assert.equal(attempts,1);assert.equal(writes,writesBeforeMismatch);
  attempts=0;
  await assert.rejects(callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,{
    ...pinned,fetchImpl:async()=>{attempts++;return new Response(JSON.stringify(errorEnvelope('api-stopping')),
      {status:409,headers:{'content-type':'application/json'}});},
  }),error=>error.kind==='api-stopping');
  assert.equal(attempts,1);

  let metadata=0,posts=0;
  const autoPinned={baseUrl,fetchImpl:async(url,init)=>{
    if(init.method==='GET'){metadata++;return localHttpFetch(url,init);}
    posts++;assert.equal(init.headers[SSE_API_INSTANCE_HEADER],expectedInstanceId);return localHttpFetch(url,init);
  }};
  assert.equal((await callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,autoPinned)).ok,true);
  assert.equal(metadata,1);assert.equal(posts,1);
  metadata=0;posts=0;
  await assert.rejects(callApiOperationWithBusyRetry('workspace_file_write_text',original,2000,{
    baseUrl,fetchImpl:async(url,init)=>{
      if(init.method==='GET'){
        metadata++;const identity=await (await localHttpFetch(url,init)).json();
        return new Response(JSON.stringify({...identity,instanceId:randomUUID()}),{headers:{'content-type':'application/json'}});
      }
      posts++;return localHttpFetch(url,init);
    },
  }),error=>error.kind==='api-instance-mismatch'&&error.httpStatus===409);
  assert.equal(metadata,1);assert.equal(posts,1);

  attempts=0;
  await assert.rejects(callApiOperationWithBusyRetry('launch',{},30000,{
    ...pinned,fetchImpl:async()=>{attempts++;assert.fail('Insufficient launch budget dispatched.');},
  }),error=>error.kind==='busy-budget-exhausted');
  assert.equal(attempts,0);
  assert.equal((await callApiOperationWithBusyRetry('workspace_file_write_text',original,200,{
    ...pinned,fetchImpl:async(url,init)=>{assert.equal(JSON.parse(init.body).timeoutMs,200);return localHttpFetch(url,init);},
  },{maxAttempts:1})).ok,true,'One attempt retains the original raw operation budget.');
}finally{server.close();await once(server,'close');}
console.log('api-busy-retry: real admission, 3-attempt bound, immutable arguments, exact HTTP409, no uncertain replay, shared deadline and cancellation passed');
