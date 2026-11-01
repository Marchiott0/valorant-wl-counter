import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage,validateConfig } from '../src/storage.mjs';

test('strict validation blocks stylesheet injection and invalid identity',()=>{
  for(const config of [{riotId:'no-tag'},{region:'invalid'},{platform:'mobile'},{timeZone:'Not/A_Zone'},{pollSeconds:29},{pollSeconds:301},{style:{fontFamily:'url(https://attacker)'}},{style:{fontSize:1000}},{style:{winColor:'red;display:none'}},{apiKey:'bad\nkey'}]) assert.throws(()=>validateConfig(config));
});
test('general settings validate and persist independently of the API key',()=>{
  const config=validateConfig({region:'na',platform:'console',timeZone:'Asia/Tokyo',pollSeconds:45});
  assert.equal(config.platform,'console');assert.equal(config.timeZone,'Asia/Tokyo');assert.equal(config.pollSeconds,45);
});
test('config/state persist atomically; private key is encrypted and never in JSON',{skip:process.platform!=='win32'},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'valorant-wl-storage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new Storage(dir);await store.init();const config=validateConfig({riotId:'Player#BR1'});
  const secret='test-only-not-a-real-key-123456';await store.saveConfig(config,secret);await store.saveState({day:'2026-10-31',wins:2});
  assert.deepEqual(await store.loadConfig(),config);assert.equal(await store.loadKey(),secret);
  assert.doesNotMatch(await readFile(join(dir,'config.json'),'utf8'),new RegExp(secret));assert.equal((await readFile(join(dir,'api-key.dpapi'))).includes(Buffer.from(secret)),false);
  assert.equal((await store.loadState()).wins,2);
});
test('corrupted secret produces a safe recoverable warning',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'valorant-wl-corrupt-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new Storage(dir,{protect:async x=>x,unprotect:async()=>{throw new Error('secret must not leak');}});await store.init();await store.saveConfig(validateConfig({}), 'fake-secret');
  assert.equal(await store.loadKey(),'');assert.doesNotMatch(store.warning,/secret must not leak/);
});
