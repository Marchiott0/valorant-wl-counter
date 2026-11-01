import test from 'node:test';
import assert from 'node:assert/strict';
import { HenrikClient, ApiError } from '../src/henrik.mjs';
import { match, page, NOW, PUUID } from './fixtures/v4.mjs';
const args={name:'Teste com espaço',tag:'BR1',region:'br',puuid:PUUID,now:NOW};
const ok=data=>new Response(JSON.stringify({status:200,data}),{status:200});
const client=options=>new HenrikClient({apiKey:'secret-test-key',now:()=>NOW,sleep:async()=>{},...options});

test('account uses documented endpoint, encoded names and Authorization header only',async()=>{
  let observed;const api=client({fetchImpl:async(url,options)=>{observed={url,options};return ok({puuid:PUUID,name:'Tester',tag:'BR1',region:'br'});}});
  assert.equal((await api.getAccount('Name with spaces','BR1')).puuid,PUUID);
  assert.equal(observed.url.pathname,'/valorant/v1/account/Name%20with%20spaces/BR1');
  assert.equal(observed.url.origin,'https://api.henrikdev.xyz');assert.equal(observed.options.headers.Authorization,'secret-test-key');assert.equal(observed.options.redirect,'error');assert.doesNotMatch(observed.url.href,/secret/);
});
test('history paginates with official start/size/mode and reaches prior-day boundary',async()=>{
  const offsets=[];const api=client({fetchImpl:async url=>{const offset=Number(url.searchParams.get('start'));offsets.push(offset);assert.equal(url.searchParams.get('mode'),'competitive');return ok(page(offset,{date:offset===0?'2026-10-31':'2026-10-30'}));}});
  const result=await api.getDailyMatches(args);assert.equal(result.complete,true);assert.equal(result.matches.length,20);assert.deepEqual(offsets,[0,10]);
});
test('console and PC platforms produce documented distinct endpoints',async()=>{
  const paths=[];const api=client({fetchImpl:async url=>{paths.push(url.pathname);return ok(page(0,{date:'2026-10-30'}));}});
  for(const platform of ['pc','console']) await api.getDailyMatches({...args,platform});
  assert.match(paths[0],/\/br\/pc\//);assert.match(paths[1],/\/br\/console\//);
});
test('history boundary uses chosen timezone',async()=>{
  const api=client({fetchImpl:async()=>ok(page(0,{date:'2026-10-31'}))});
  // At 02:00 UTC, these matches are yesterday in UTC, but today in Tokyo.
  const query={...args,now:Date.parse('2026-11-01T02:00:00Z')};
  assert.equal((await api.getDailyMatches({...query,timeZone:'UTC'})).complete,true);
  const tokyo=await api.getDailyMatches({...query,timeZone:'Asia/Tokyo'});
  assert.equal(tokyo.complete,false);assert.ok(['unstable_pagination','overlapping_history'].includes(tokyo.reason));
});
test('short or empty history does not falsely claim complete daily history',async()=>{
  for(const data of [[],[match()],[match({start:'2026-10-30T12:00:00Z'})]]) {
    const result=await client({fetchImpl:async()=>ok(data)}).getDailyMatches(args);assert.equal(result.complete,false);
  }
});
test('pagination cap or ignored offset returns incomplete',async()=>{
  let call=0;const capped=await client({maxPages:2,fetchImpl:async()=>ok(page(10*call++))}).getDailyMatches(args);assert.equal(capped.complete,false);assert.equal(capped.reason,'history_limit');
  const repeated=await client({fetchImpl:async()=>ok(page(0))}).getDailyMatches(args);assert.equal(repeated.complete,false);
});
test('duplicate IDs cannot pad a short history into an apparently complete page',async()=>{
  const data=page(0,{date:'2026-10-30'});data[1]=structuredClone(data[0]);
  const result=await client({fetchImpl:async()=>ok(data)}).getDailyMatches(args);
  assert.equal(result.complete,false);assert.equal(result.reason,'overlapping_history');
});
test('a successful response with exhausted quota prevents the next API request',async()=>{
  let calls=0;const api=client({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({status:200,data:{puuid:PUUID}}),{headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'45'}});}});
  await api.getAccount('name','tag');await assert.rejects(api.getAccount('name','tag'),error=>error.status===429&&error.retryAfterMs===45000);assert.equal(calls,1);
});
test('invalid timestamp and reordered pages return incomplete',async()=>{
  const data=page(0);data[3].metadata.started_at='invalid';assert.equal((await client({fetchImpl:async()=>ok(data)}).getDailyMatches(args)).complete,false);
  assert.equal((await client({fetchImpl:async()=>ok(page(0).reverse())}).getDailyMatches(args)).complete,false);
});
test('network failures retry exponentially and emit only a safe error',async()=>{
  let calls=0;const waits=[];const api=client({sleep:async ms=>waits.push(ms),fetchImpl:async()=>{calls++;throw new Error('secret-test-key upstream details');}});
  await assert.rejects(api.getAccount('name','tag'),error=>error instanceof ApiError&&!error.message.includes('secret-test-key'));
  assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);
});
test('transient HTTP 503 retries before successful result',async()=>{
  let calls=0;const api=client({fetchImpl:async()=>++calls===1?new Response('private upstream',{status:503}):ok({puuid:PUUID})});
  assert.equal((await api.getAccount('name','tag')).puuid,PUUID);assert.equal(calls,2);
});
test('HTTP 429 honors the greater Retry-After/reset and avoids early retry',async()=>{
  let calls=0;const api=client({fetchImpl:async()=>{calls++;return new Response('private token',{status:429,headers:{'retry-after':'60','x-ratelimit-reset':'120'}});}});
  await assert.rejects(api.getAccount('name','tag'),error=>error.status===429&&error.retryAfterMs===120000&&!error.message.includes('private'));
  await assert.rejects(api.getAccount('name','tag'),error=>error.status===429);assert.equal(calls,1);
});
test('short HTTP 429 waits and retries, HTTP-date retry-after is respected',async()=>{
  let calls=0;const waits=[];const api=client({sleep:async ms=>waits.push(ms),fetchImpl:async()=>++calls===1?new Response('',{status:429,headers:{'retry-after':'2'}}):ok({puuid:PUUID})});
  await api.getAccount('name','tag');assert.deepEqual(waits,[2000]);assert.equal(calls,2);
  const dateApi=client({fetchImpl:async()=>new Response('',{status:429,headers:{'retry-after':new Date(NOW+60000).toUTCString()}})});
  await assert.rejects(dateApi.getAccount('name','tag'),error=>error.retryAfterMs===60000);
});
test('unauthorized response never retries or exposes response body',async()=>{
  let calls=0;const api=client({fetchImpl:async()=>{calls++;return new Response('secret-test-key',{status:401});}});
  await assert.rejects(api.getAccount('name','tag'),error=>error.status===401&&!error.message.includes('secret'));assert.equal(calls,1);
});
test('HTTP 200 malformed JSON cannot become a successful result',async()=>{
  for(const raw of ['{','{}','{"status":200,"data":{}}']) {
    const api=client({fetchImpl:async()=>new Response(raw)});await assert.rejects(api.getAccount('name','tag'),ApiError);
  }
});
test('timeout abort signal is attached and network errors stay sanitized',async()=>{
  let signal;const api=client({timeoutMs:5,maxRetries:0,fetchImpl:async(url,options)=>{signal=options.signal;return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason));setTimeout(()=>reject(new Error('test timeout fallback')),30);});}});
  await assert.rejects(api.getAccount('name','tag'),ApiError);assert.equal(signal.aborted,true);
});
