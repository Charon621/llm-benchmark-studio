import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
process.env.STUDIO_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'studio-worker-secrets-'));
const {seed}=await import('../src/seeds.js');
const {library,saveLibrary,runDir}=await import('../src/storage.js');
const {saveModel}=await import('../src/model-registry.js');
const {launch}=await import('../src/runner.js');
test('worker gets only the selected credential over IPC; environment and all initial run artifacts contain no secret',async()=>{
 seed();const owner='a'.repeat(64),lib=library();saveLibrary(lib,owner);
 const selected='selected-fixture-credential',unselected='unselected-fixture-credential',environment='environment-fixture-credential';
 const first=saveModel(owner,{name:'one',provider:'custom',protocol:'openai',model:'LOCAL_FIXTURE',base_url:'https://fixture.invalid/v1',api_key:selected}).model;
 saveModel(owner,{name:'two',provider:'custom',protocol:'openai',model:'OTHER_FIXTURE',base_url:'https://fixture.invalid/v1',api_key:unselected});
 const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY=environment;let spawn,ipc;
 try{
  const forkWorker=(file,args,options)=>{spawn={file,args,options};const worker=new EventEmitter();worker.kill=()=>{};worker.send=message=>{ipc=message;queueMicrotask(()=>{worker.emit('message',{type:'complete',completed:0,engine_id:'fixture-engine'});worker.emit('exit',0,null);});};return worker;};
  const state=launch({dataset_id:lib.datasets[0].id,prompt_ids:['direct'],model_ids:[first.id],repeats:1,confirm_live:true},null,owner,{forkWorker});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ipc.type,'credentials');assert.deepEqual(ipc.credentials,[[first.credential_id,selected]]);assert.ok(!JSON.stringify(spawn.options.env).includes(environment));assert.ok(!JSON.stringify(spawn.options.env).includes(selected));assert.ok(!JSON.stringify(spawn.options.env).includes(unselected));
  for(const file of fs.readdirSync(runDir(state.id))){const content=fs.readFileSync(path.join(runDir(state.id),file),'utf8');for(const secret of [selected,unselected,environment])assert.ok(!content.includes(secret),file);}
 }finally{if(previous==null)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});
