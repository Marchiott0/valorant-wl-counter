import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { get } from 'node:http';
import { createServer } from '../src/server.mjs';

async function setup(t) {
  const engine=new EventEmitter();engine.state={wins:2,losses:1,known:true,day:'2026-10-31'};
  engine.publicConfig=()=>({riotId:'Tester#BR',hasApiKey:true});engine.getState=()=>engine.state;engine.configure=async()=>engine.publicConfig();engine.refresh=async()=>engine.state;
  const server=createServer(engine,{port:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeStreams();server.closeAllConnections();server.close(resolve);}));
  return {server,engine,base:`http://127.0.0.1:${server.address().port}`};
}
test('serves setup and transparent overlay without exposing private files',async t=>{
  const {base}=await setup(t);
  for(const path of ['/','/overlay','/app.js','/overlay.js']) {const r=await fetch(base+path);assert.equal(r.status,200);assert.ok(r.headers.get('content-security-policy'));}
  for(const path of ['/data/config.json','/data/api-key.dpapi','/src/storage.mjs','/package.json']) assert.equal((await fetch(base+path)).status,404);
  const css=await (await fetch(base+'/overlay.css')).text();assert.match(css,/transparent/);
});
test('rejects foreign origin, DNS rebinding and unprotected writes',async t=>{
  const {base}=await setup(t);
  assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://attacker.example'}})).status,403);
  const rebound=await new Promise((resolve,reject)=>{
    get(base+'/api/state',{headers:{Host:'attacker.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);
  });
  assert.equal(rebound,403);
  assert.equal((await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const good=await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'valorant-wl'},body:'{}'});assert.equal(good.status,200);assert.equal((await good.json()).hasApiKey,true);
});
test('SSE delivers initial count and automatic updates without page reload',async t=>{
  const {base,engine}=await setup(t);const controller=new AbortController();t.after(()=>controller.abort());
  const response=await fetch(base+'/api/events',{signal:controller.signal});assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/event: state/);assert.match(first,/"wins":2/);
  engine.emit('state',{...engine.state,wins:3});const next=new TextDecoder().decode((await reader.read()).value);assert.match(next,/"wins":3/);await reader.cancel();
});
