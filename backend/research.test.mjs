import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeString,ipfsImage,publicImage,scoreReport,units,validAddress} from '../dist/client/research.mjs';
import {publicWebsite} from './integrations.mjs';
import worker from '../dist/server/index.js';

test('formats token units without a trailing decimal point',()=>{
  assert.equal(units('1000000000000000000',18),'1');
  assert.equal(units('1250000',6),'1.25');
});

test('decodes ABI strings and rejects malformed values',()=>{
  const word='4341540000000000000000000000000000000000000000000000000000000000';
  assert.equal(decodeString('0x'+word),'CAT');
  assert.equal(decodeString('not-hex'),null);
});

test('validates public research inputs',()=>{
  assert.equal(validAddress('0x'+'a'.repeat(40)),true);
  assert.equal(publicWebsite('https://example.com/path'),'https://example.com/path');
  assert.throws(()=>publicWebsite('http://localhost/admin'));
});

test('only turns IPFS token artwork into a public image URL',()=>{
  assert.equal(ipfsImage('ipfs://bafy123/logo.png'),'https://gateway.pinata.cloud/ipfs/bafy123/logo.png');
  assert.equal(ipfsImage('https://tracker.example/logo.png'),null);
  assert.equal(publicImage('https://cdn.dexscreener.com/token.png'),'https://cdn.dexscreener.com/token.png');
  assert.equal(publicImage('http://localhost/token.png'),null);
});

test('builds a weighted score only from available evidence',()=>{
  const result=scoreReport({holderStats:{top10Pct:90,count:2,countLabel:'2'},market:{depthUsd:50,depthKind:'raised'},launch:{creatorTaxBps:0}});
  assert.equal(result.coverage,50);
  assert.ok(result.score>=65&&result.score<=80);
  assert.equal(result.factors.length,3);
  assert.equal(result.lenses.length,6);
  assert.equal(result.lenses.filter(l=>l.status==='NOT CHECKED').length,3);
});

test('a critical red flag cannot be averaged into a low-risk score',()=>{
  const result=scoreReport({holderStats:{top10Pct:61,count:500,countLabel:'500'},market:{depthUsd:500000,volume24hUsd:1000000,priceChange24hPct:1,buys24h:100,sells24h:100}});
  assert.equal(result.redFlags,1);
  assert.ok(result.score>=55);
});

test('a burned LP position lowers the liquidity risk without claiming a lock',()=>{
  const base={market:{depthUsd:20000}};
  const unburned=scoreReport({...base,lpSafety:{burnedPct:0}}).factors.find(f=>f.name==='Liquidity & LP');
  const burned=scoreReport({...base,lpSafety:{burnedPct:100}}).factors.find(f=>f.name==='Liquidity & LP');
  assert.ok(burned.score<unburned.score);
  assert.match(burned.detail,/external locker status not indexed/);
});

test('does not treat missing scam checks as safe evidence',()=>{
  const result=scoreReport({});
  assert.equal(result.score,null);
  assert.equal(result.coverage,0);
  assert.equal(result.lenses.length,6);
});

test('worker exposes health and rejects malformed history addresses',async()=>{
  assert.equal(typeof worker.scheduled,'function');
  const assetUrls=[];const env={ASSETS:{fetch:request=>{assetUrls.push(request.url);return new Response('asset')}}};
  const health=await worker.fetch(new Request('https://octo.test/api/health'),env);
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
  const history=await worker.fetch(new Request('https://octo.test/api/history?address=bad'),env);
  assert.equal(history.status,400);
  const snapshot=await worker.fetch(new Request('https://octo.test/api/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),env);
  assert.equal(snapshot.status,400);
  const watch=await worker.fetch(new Request('https://octo.test/api/watch?addresses=bad'),env);
  assert.equal(watch.status,400);
  const address='0x'+'a'.repeat(40),shared=await worker.fetch(new Request('https://octo.test/token/'+address),env);
  assert.equal(await shared.text(),'asset');
  assert.equal(assetUrls.at(-1),'https://octo.test/');
});
