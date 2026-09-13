import {analyzeToken,validAddress,PUBLIC_RPC} from './research.js';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(data,status=200)=>Response.json(data,{status,headers});
const LAUNCH_FACTORIES=[
  {address:'0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',topic:'0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607',deployerTopic:3,version:'v2'},
  {address:'0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB',topic:'0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a',deployerTopic:2,version:'v1'},
  {address:'0x0c37a24F5D23A486FA692d1500881d698B1F77a4',topic:'0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a',deployerTopic:2,version:'v1 legacy'}
];

async function cachedReport(db,key){
  if(!db)return null;
  try{return await db.prepare('SELECT body FROM report_cache WHERE cache_key=? AND expires_at>?').bind(key,Date.now()).first();}
  catch(error){console.error('cache read failed',error);return null;}
}

async function allowRequest(db){
  if(!db)return true;
  try{const minute=new Date().toISOString().slice(0,16),expires=Date.now()+120000;const row=await db.prepare('INSERT INTO quotas(bucket,used,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET used=used+1 WHERE used<20 RETURNING used').bind('minute:'+minute,expires).first();return !!row;}
  catch(error){console.error('rate limit failed',error);return true;}
}

const snapshotBody=report=>({marketCapUsd:report.market?.marketCapUsd??null,priceUsd:report.market?.priceUsd??null,depthUsd:report.market?.depthUsd??null,holderCount:report.holderStats?.count??null,holderCountExact:report.holderStats?.exact??false,top10Pct:report.holderStats?.top10Pct??null,riskScore:report.riskScore,lensCoverage:report.lensCoverage});

async function persistSnapshot(db,report){
  if(!db)return false;
  try{const body=snapshotBody(report),day=report.retrievedAt.slice(0,10);await db.batch([
    db.prepare('INSERT INTO snapshots(address,observed_day,observed_at,block,market_cap_usd,holder_count,holder_count_exact,top10_pct,depth_usd,risk_score,lens_coverage,body) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(address,observed_day) DO UPDATE SET observed_at=excluded.observed_at,block=excluded.block,market_cap_usd=excluded.market_cap_usd,holder_count=excluded.holder_count,holder_count_exact=excluded.holder_count_exact,top10_pct=excluded.top10_pct,depth_usd=excluded.depth_usd,risk_score=excluded.risk_score,lens_coverage=excluded.lens_coverage,body=excluded.body').bind(report.address,day,report.retrievedAt,report.block,body.marketCapUsd,body.holderCount,body.holderCountExact?1:0,body.top10Pct,body.depthUsd,body.riskScore,body.lensCoverage,JSON.stringify(body)),
    db.prepare('DELETE FROM quotas WHERE expires_at<?').bind(Date.now())
  ]);return true;}catch(error){console.error('snapshot persistence failed',error);return false;}
}

async function persistReport(db,key,report){
  if(!db)return false;
  try{await db.batch([
    db.prepare('INSERT OR REPLACE INTO report_cache(cache_key,body,expires_at) VALUES(?,?,?)').bind(key,JSON.stringify(report),Date.now()+15*60*1000),
    db.prepare('DELETE FROM quotas WHERE expires_at<?').bind(Date.now())
  ]);return await persistSnapshot(db,report);}catch(error){console.error('persistence failed',error);return false;}
}

async function refreshTracked(env){
  if(!env.DB)return;
  const rows=await env.DB.prepare('SELECT address,MAX(observed_at) AS last_seen FROM snapshots GROUP BY address ORDER BY last_seen DESC LIMIT 5').all();
  for(const row of rows.results||[]){try{const report=await analyzeToken(row.address,{rpcUrl:env.ROBINHOOD_RPC_URL||PUBLIC_RPC});await persistReport(env.DB,'report:'+row.address.toLowerCase(),report);}catch(error){console.error('scheduled analysis failed',row.address,error);}}
}

const bounded=(value,min,max)=>value===null||value===undefined?null:Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):null;
function clientReport(input){
  if(!validAddress(input.address)||input.chainId!==4663||!Number.isInteger(input.block)||input.block<1)throw new Error('Invalid snapshot');
  const body=input.metrics||{},holderCount=bounded(body.holderCount,0,1e9),top10Pct=bounded(body.top10Pct,0,100),riskScore=bounded(body.riskScore,0,100),lensCoverage=bounded(body.lensCoverage,0,100);
  return {address:input.address.toLowerCase(),chainId:4663,block:input.block,retrievedAt:new Date().toISOString(),market:{marketCapUsd:bounded(body.marketCapUsd,0,1e18),priceUsd:bounded(body.priceUsd,0,1e12),depthUsd:bounded(body.depthUsd,0,1e18)},holderStats:holderCount===null&&top10Pct===null?null:{count:holderCount,exact:body.holderCountExact===true,top10Pct},riskScore,lensCoverage};
}

async function history(db,address){
  if(!db)return [];
  const result=await db.prepare('SELECT observed_day,observed_at,block,market_cap_usd,holder_count,holder_count_exact,top10_pct,depth_usd,risk_score,lens_coverage FROM snapshots WHERE address=? ORDER BY observed_at DESC LIMIT 30').bind(address.toLowerCase()).all();
  return result.results||[];
}

async function watchedReports(db,addresses){
  if(!db||!addresses.length)return [];
  const rows=await db.batch(addresses.map(address=>db.prepare('SELECT body FROM report_cache WHERE cache_key=?').bind('report:'+address)));
  return rows.flatMap((result,index)=>{const row=result.results?.[0];if(!row)return[];try{return[{...JSON.parse(row.body),address:addresses[index]}];}catch{return[];}});
}

const topicAddress=topic=>topic&&topic.length===66?'0x'+topic.slice(-40).toLowerCase():null;
async function rpcCall(rpcUrl,method,params){const response=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(!response.ok)throw new Error('RPC unavailable');const data=await response.json();if(data.error)throw new Error(data.error.message||'RPC unavailable');return data.result;}
async function newTokens(env){
  const cacheKey='feed:new-tokens:v2',cached=await cachedReport(env.DB,cacheKey);if(cached)try{return JSON.parse(cached.body);}catch{}
  const rpcUrl=env.ROBINHOOD_RPC_URL||PUBLIC_RPC,blockHex=await rpcCall(rpcUrl,'eth_blockNumber',[]),block=Number(BigInt(blockHex)),fromBlock='0x'+Math.max(0,block-2000).toString(16);
  const batches=await Promise.allSettled(LAUNCH_FACTORIES.map(factory=>rpcCall(rpcUrl,'eth_getLogs',[{address:factory.address,fromBlock,toBlock:blockHex,topics:[factory.topic]}]))),found=[];
  if(!batches.some(batch=>batch.status==='fulfilled'))throw new Error('Launch RPC unavailable');
  batches.forEach((batch,index)=>{if(batch.status==='fulfilled')for(const log of batch.value||[]){const factory=LAUNCH_FACTORIES[index],address=topicAddress(log.topics?.[1]),deployer=topicAddress(log.topics?.[factory.deployerTopic]);if(address)found.push({address,deployer,version:factory.version,block:Number(BigInt(log.blockNumber)),transactionHash:log.transactionHash||null});}});
  const unique=[...new Map(found.sort((a,b)=>b.block-a.block).map(item=>[item.address,item])).values()].slice(0,24),reports=await watchedReports(env.DB,unique.map(item=>item.address)),byAddress=new Map(reports.map(report=>[report.address.toLowerCase(),report]));
  const launches=unique.map(item=>{const report=byAddress.get(item.address);return{...item,name:report?.name||'New token',symbol:report?.symbol||'',logoUrl:report?.logoUrl||null,riskScore:report?.riskScore??null,riskCoverage:report?.riskCoverage??null,marketCapUsd:report?.market?.marketCapUsd??null,liquidityUsd:report?.market?.depthUsd??null};});
  if(env.DB)try{await env.DB.prepare('INSERT OR REPLACE INTO report_cache(cache_key,body,expires_at) VALUES(?,?,?)').bind(cacheKey,JSON.stringify(launches),Date.now()+2*60*1000).run();}catch(error){console.error('new token cache failed',error);}
  return launches;
}

export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/health')return json({ok:true,storage:!!env.DB,providers:{rpc:true,pons:true,ethUsd:true}});
  if(url.pathname==='/api/history'){
    if(request.method!=='GET')return json({error:'GET required'},405);
    const address=url.searchParams.get('address');if(!validAddress(address))return json({error:'Invalid contract address'},400);
    try{return json({address:address.toLowerCase(),snapshots:await history(env.DB,address)});}catch(error){console.error('history read failed',error);return json({error:'History is temporarily unavailable'},503);}
  }
  if(url.pathname==='/api/watch'){
    if(request.method!=='GET')return json({error:'GET required'},405);
    const addresses=(url.searchParams.get('addresses')||'').split(',').map(value=>value.toLowerCase()).filter(Boolean);if(!addresses.length||addresses.length>20||addresses.some(address=>!validAddress(address)))return json({error:'Provide 1-20 valid contract addresses'},400);
    try{return json({reports:await watchedReports(env.DB,[...new Set(addresses)])});}catch(error){console.error('watchlist read failed',error);return json({error:'Watchlist refresh is temporarily unavailable'},503);}
  }
  if(url.pathname==='/api/new-tokens'){
    if(request.method!=='GET')return json({error:'GET required'},405);
    try{return json({chainId:4663,tokens:await newTokens(env)});}catch(error){console.error('new token feed failed',error);return json({error:'New-token feed is temporarily unavailable'},503);}
  }
  if(url.pathname==='/api/snapshot'){
    if(request.method!=='POST')return json({error:'POST required'},405);
    if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Same-origin requests required'},403);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required'},415);
    try{const raw=await request.text();if(raw.length>2048)return json({error:'Request too large'},413);if(!await allowRequest(env.DB))return json({error:'Research rate limit reached; retry in one minute'},429);const report=clientReport(JSON.parse(raw)),stored=await persistSnapshot(env.DB,report);return json({stored,historyCount:stored?(await history(env.DB,report.address)).length:0});}
    catch(error){console.error('snapshot rejected',error);return json({error:'Invalid snapshot'},400);}
  }
  if(url.pathname!=='/api/analyze'){
    if(request.method==='GET'&&/^\/token\/0x[a-fA-F0-9]{40}\/?$/.test(url.pathname))return env.ASSETS.fetch(new Request(new URL('/',url),{headers:request.headers}));
    return env.ASSETS.fetch(request);
  }
  if(request.method!=='POST')return json({error:'POST required'},405);
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Same-origin requests required'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required'},415);
  try{
    const raw=await request.text();if(raw.length>1024)return json({error:'Request too large'},413);
    const input=JSON.parse(raw);if(!validAddress(input.address))return json({error:'Invalid contract address'},400);
    const key='report:'+input.address.toLowerCase(),cached=await cachedReport(env.DB,key);
    if(cached){const report={...JSON.parse(cached.body),cached:true};report.historyCount=(await history(env.DB,input.address)).length;return json(report);}
    if(!await allowRequest(env.DB))return json({error:'Research rate limit reached; retry in one minute'},429);
    const report=await analyzeToken(input.address,{rpcUrl:env.ROBINHOOD_RPC_URL||PUBLIC_RPC});
    report.stored=await persistReport(env.DB,key,report);report.historyCount=report.stored?(await history(env.DB,input.address)).length:0;
    return json(report);
  }catch(error){console.error('analysis failed',error);return json({error:/Invalid/.test(error.message)?error.message:'Analysis unavailable. Verify the contract and retry.'},400);}
},async scheduled(controller,env,ctx){ctx.waitUntil(refreshTracked(env));}};
