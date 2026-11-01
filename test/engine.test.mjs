import test from 'node:test';
import assert from 'node:assert/strict';
import { CounterEngine } from '../src/engine.mjs';
import { DEFAULT_CONFIG } from '../src/storage.mjs';

const NOW=Date.parse('2026-10-31T18:00:00Z');
function memory(saved=null) {
  return {config:{...structuredClone(DEFAULT_CONFIG),riotId:'Tester#BR1'},key:'test-key',saved,
    async init(){},async loadConfig(){return this.config;},async loadKey(){return this.key;},async loadState(){return this.saved;},
    async saveConfig(config,key){this.config=config;if(key)this.key=key;},async saveState(value){this.saved=structuredClone(value);}};
}
function validState() {return {identity:JSON.stringify(['br','pc','America/Sao_Paulo','tester#br1']),day:'2026-10-31',wins:2,losses:1,known:true,complete:true,lastSuccess:new Date(NOW-60000).toISOString()};}
function client(overrides={}) {return {async getAccount(){return {puuid:'test-puuid'};},async getDailyMatches(){return {matches:[],complete:true};},...overrides};}

test('restart restores the last confirmed same-account, same-day count',async()=>{
  const engine=await new CounterEngine(memory(validState()),{now:()=>NOW}).init();
  assert.equal(engine.getState().wins,2);assert.equal(engine.getState().losses,1);assert.equal(engine.getState().status,'stale');
});
test('yesterday or another account cache cannot become today totals',async()=>{
  for(const bad of [{...validState(),day:'2026-10-30'},{...validState(),identity:'br:other#br1'},{...validState(),wins:-1}]) {
    const engine=await new CounterEngine(memory(bad),{now:()=>NOW}).init();assert.equal(engine.getState().known,false);
  }
});
test('midnight in Belem immediately invalidates yesterday numbers',async()=>{
  let now=Date.parse('2026-11-01T02:59:59Z');
  const engine=await new CounterEngine(memory(validState()),{now:()=>now}).init();
  assert.equal(engine.getState().known,true);now+=1000;
  assert.equal(engine.getState().day,'2026-11-01');assert.equal(engine.getState().known,false);assert.equal(engine.getState().wins,0);
});
test('network failure never increases count and never persists a new result',async()=>{
  const store=memory(validState());const engine=await new CounterEngine(store,{now:()=>NOW,clientFactory:()=>client({async getDailyMatches(){throw new Error('private token should not leak');}})}).init();
  await engine.refresh();assert.equal(engine.getState().wins,2);assert.equal(engine.getState().status,'stale');assert.equal(store.saved.lastSuccess,validState().lastSuccess);assert.doesNotMatch(JSON.stringify(engine.getState()),/private token/);
});
test('incomplete history preserves confirmed count and is visibly marked',async()=>{
  const engine=await new CounterEngine(memory(validState()),{now:()=>NOW,clientFactory:()=>client({async getDailyMatches(){return {matches:[],complete:false,reason:'cap'};}})}).init();
  await engine.refresh();assert.equal(engine.getState().wins,2);assert.equal(engine.getState().status,'incomplete');assert.equal(engine.getState().complete,false);
});
test('first incomplete response shows unknown instead of fabricated zero',async()=>{
  const engine=await new CounterEngine(memory(),{now:()=>NOW,clientFactory:()=>client({async getDailyMatches(){return {matches:[],complete:false};}})}).init();
  await engine.refresh();assert.equal(engine.getState().known,false);
});
test('successful full empty history persists confirmed zero and emits update',async()=>{
  const store=memory();let updates=0;const engine=await new CounterEngine(store,{now:()=>NOW,clientFactory:()=>client()}).init();engine.on('state',()=>updates++);
  await engine.refresh();assert.equal(engine.getState().known,true);assert.equal(engine.getState().wins,0);assert.equal(store.saved.complete,true);assert.ok(updates>=2);
});
test('concurrent refresh calls coalesce and manual calls respect poll interval',async()=>{
  let calls=0;let release;const pending=new Promise(resolve=>release=resolve);
  const engine=await new CounterEngine(memory(),{now:()=>NOW,clientFactory:()=>client({async getDailyMatches(){calls++;await pending;return {matches:[],complete:true};}})}).init();
  const a=engine.refresh(),b=engine.refresh();assert.equal(a,b);release();await a;await engine.refresh();assert.equal(calls,1);
});
test('account change during request discards the old response',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve);
  const engine=await new CounterEngine(memory(),{now:()=>NOW,clientFactory:()=>client({async getDailyMatches(){await pending;return {matches:[],complete:true};}})}).init();
  const refreshing=engine.refresh();await new Promise(resolve=>setImmediate(resolve));await engine.configure({riotId:'Other#BR1'});release();await refreshing;
  assert.equal(engine.getState().known,false);assert.equal(engine.publicConfig().riotId,'Other#BR1');
});
test('style-only configuration keeps identity and the write-only credential',async()=>{
  const engine=await new CounterEngine(memory(validState()),{now:()=>NOW}).init();
  await engine.configure({style:{fontSize:88}});assert.equal(engine.publicConfig().riotId,'Tester#BR1');assert.equal(engine.publicConfig().hasApiKey,true);assert.equal(engine.getState().wins,2);assert.doesNotMatch(JSON.stringify(engine.publicConfig()),/test-key/);
});
test('changing timezone or platform invalidates previous counts and cached identity',async()=>{
  for(const change of [{timeZone:'Asia/Tokyo'},{platform:'console'}]) {
    const store=memory(validState());const engine=await new CounterEngine(store,{now:()=>NOW}).init();
    await engine.configure(change);assert.equal(engine.getState().known,false);assert.equal(engine.getState().configured,true);
    const restarted=await new CounterEngine(store,{now:()=>NOW}).init();assert.equal(restarted.getState().known,false);
  }
});
test('timezone change discards an in-flight result even when calendar date stays the same',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve);const store=memory();
  const engine=await new CounterEngine(store,{now:()=>NOW,clientFactory:()=>client({async getDailyMatches(){await pending;return {matches:[],complete:true};}})}).init();
  const running=engine.refresh();await new Promise(resolve=>setImmediate(resolve));await engine.configure({timeZone:'UTC'});release();await running;
  assert.equal(engine.getState().timeZone,'UTC');assert.equal(engine.getState().known,false);assert.equal(store.saved,null);
});
test('chosen platform and timezone reach the API, and polling uses the configured interval',async()=>{
  let seen;const store=memory();store.config={...store.config,platform:'console',timeZone:'Asia/Tokyo',pollSeconds:120};
  const engine=await new CounterEngine(store,{now:()=>NOW,clientFactory:()=>client({async getDailyMatches(input){seen=input;return {matches:[],complete:true};}})}).init();
  await engine.refresh();assert.equal(seen.platform,'console');assert.equal(seen.timeZone,'Asia/Tokyo');assert.equal(Date.parse(engine.getState().nextPoll)-NOW,120000);
});
test('changing frequency cannot bypass a 429 backoff',async()=>{
  const {ApiError}=await import('../src/henrik.mjs');const store=memory();
  const engine=await new CounterEngine(store,{now:()=>NOW,clientFactory:()=>client({async getDailyMatches(){throw new ApiError('limit',{status:429,retryAfterMs:180000});}})}).init();
  await engine.refresh();const before=engine.getState().nextPoll;await engine.configure({pollSeconds:30});assert.equal(engine.getState().nextPoll,before);
});
