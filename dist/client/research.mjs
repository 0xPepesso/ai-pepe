export const PUBLIC_RPC='https://rpc.mainnet.chain.robinhood.com';
export const validAddress=a=>typeof a==='string'&&/^0x[0-9a-fA-F]{40}$/.test(a);
export function ipfsImage(value){
  if(typeof value!=='string'||!value.startsWith('ipfs://'))return null;
  const path=value.slice(7).replace(/^ipfs\//,'');
  if(!/^[a-zA-Z0-9]+(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%-]+)*$/.test(path)||path.length>500)return null;
  return 'https://gateway.pinata.cloud/ipfs/'+path;
}
export function publicImage(value){
  const ipfs=ipfsImage(value);if(ipfs)return ipfs;
  if(typeof value!=='string'||value.length>1000)return null;
  try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||url.hostname==='localhost'||/^\d+(?:\.\d+){3}$/.test(url.hostname))return null;return url.href;}catch{return null;}
}
export function decodeString(hex){
  if(typeof hex!=='string'||!/^0x[0-9a-f]*$/i.test(hex))return null;
  const raw=hex.slice(2);let data=raw;
  if(raw.length>64){const offset=Number(BigInt('0x'+raw.slice(0,64)))*2;if(!Number.isSafeInteger(offset)||offset+64>raw.length)return null;const length=Number(BigInt('0x'+raw.slice(offset,offset+64)));if(length>256||offset+64+length*2>raw.length)return null;data=raw.slice(offset+64,offset+64+length*2);}
  return new TextDecoder().decode(Uint8Array.from(data.match(/.{2}/g)||[],n=>parseInt(n,16))).replace(/\0/g,'').replace(/[\u0000-\u001f]/g,'').slice(0,128)||null;
}
export function units(raw,decimals){try{const d=Number(decimals);if(!Number.isInteger(d)||d<0||d>36)return null;const n=BigInt(raw),base=10n**BigInt(d),fraction=d?String(n%base).padStart(d,'0').replace(/0+$/,''):'';return String(n/base)+(fraction?'.'+fraction:'');}catch{return null;}}
const addressResult=raw=>raw&&/^0x[0-9a-f]{64}$/i.test(raw)?'0x'+raw.slice(-40):null;
const pct=(part,total)=>total>0n?Number(part*1000000n/total)/10000:null;
const riskBand=(value,bands)=>bands.find(([limit])=>value<limit)?.[1]??bands.at(-1)[2];
const clamp=value=>Math.max(0,Math.min(100,Math.round(value)));
export function scoreReport(report){
  const lenses=[],measured=(name,score,weight,detail,status='CHECKED',evidenceWeight=weight)=>lenses.push({name,score:clamp(score),weight,evidenceWeight,detail,status}),unknown=(name,weight,detail)=>lenses.push({name,score:null,weight,evidenceWeight:0,detail,status:'NOT CHECKED'});
  const signals=report.contractSignals||[],tax=report.launch?.creatorTaxBps===undefined?null:Number(report.launch.creatorTaxBps)/100,verification=report.contractVerification;
  if(verification||report.owner||report.proxyImplementation||signals.length||tax!==null){
    let risk=verification?.verified===true?10:verification?.verified===false?75:25;const notes=[];
    if(verification?.verified===true)notes.push('source code verified');else if(verification?.verified===false)notes.push('source code not verified');else notes.push('verification unavailable');
    if(report.owner&&report.owner!=='0x0000000000000000000000000000000000000000'){risk+=25;notes.push('active owner');}else if(report.owner)notes.push('zero owner');else{risk+=15;notes.push('owner/roles not confirmed');}
    if(report.proxyImplementation){risk+=20;notes.push('proxy detected');}
    if(signals.includes('mint selector'))risk+=25;if(signals.some(s=>s.includes('blacklist')))risk+=25;if(signals.some(s=>s.includes('pause')||s.includes('trading control')))risk+=20;
    if(signals.length)notes.push(signals.join(', '));
    if(tax!==null){risk+=tax<=5?0:tax>=50?40:(tax-5)*.9;notes.push(tax.toFixed(2)+'% creator tax');}
    measured('Contract safety',risk,30,notes.join(' · '),risk>=75?'RED FLAG':risk>=45?'CAUTION':verification?.verified===true&&report.owner?'CHECKED':'PARTIAL',verification?25:15);
  }else unknown('Contract safety',30,'Verification, ownership and privileged functions could not be confirmed.');
  if(report.market?.depthUsd!==null&&report.market?.depthUsd!==undefined){const d=Number(report.market.depthUsd),shown=d>0&&d<.01?'<$0.01':'$'+d.toLocaleString('en-US',{maximumFractionDigits:2}),burn=report.lpSafety?.burnedPct;let depthRisk=riskBand(d,[[100,100],[1000,95],[10000,80],[50000,60],[250000,35],[Infinity,15]]);const lpNote=Number.isFinite(burn)?burn.toFixed(2)+'% LP burned':(report.lpSafety?.poolType?report.lpSafety.poolType+' · fungible LP burn unreadable':'LP burn unreadable');if(Number.isFinite(burn)){if(burn>=95)depthRisk-=20;else if(burn===0)depthRisk+=10;}const status=depthRisk>=75?'RED FLAG':Number.isFinite(burn)&&burn>=95?'CHECKED':'PARTIAL';measured('Liquidity & LP',depthRisk,25,(report.market.depthKind==='raised'?'Raised reserve: ':'Liquidity: ')+shown+' · '+lpNote+' · external locker status not indexed',status,Number.isFinite(burn)?20:15);}
  else unknown('Liquidity & LP',25,'Liquidity depth and LP lock/burn status are unavailable.');
  if(report.holderStats){const c=report.holderStats.top10Pct;const count=report.holderStats.count;
    const concentration=c===null?0:riskBand(c,[[15,10],[20,30],[40,65],[60,82],[Infinity,95]]);
    const scarcity=count===null?0:riskBand(count,[[3,100],[10,85],[50,60],[200,35],[Infinity,15]]);
    const risk=Math.max(concentration,scarcity);measured('Holder distribution',risk,20,(c===null?'Unknown concentration':c.toFixed(1)+'% held by top 10 non-pool addresses')+' · '+report.holderStats.countLabel+' holder'+(count===1?'':'s')+' indexed · inspect linked-wallet clusters in OCTO Wallet Map',risk>=65?'RED FLAG':'CHECKED');
  }else unknown('Holder distribution',20,'Top-holder concentration and wallet clusters are unavailable.');
  const market=report.market||{},datum=value=>value===null||value===undefined?NaN:Number(value),change=datum(market.priceChange24hPct),volume=datum(market.volume24hUsd),depth=datum(market.depthUsd),buys=datum(market.buys24h),sells=datum(market.sells24h),trades=buys+sells;
  if([change,volume,buys,sells].some(Number.isFinite)){let risk=20;const notes=[];
    if(Number.isFinite(change)){const move=Math.abs(change);if(move>100)risk+=40;else if(move>50)risk+=25;else if(move>20)risk+=12;notes.push((change>=0?'+':'')+change.toFixed(1)+'% / 24h');}
    if(Number.isFinite(volume)&&Number.isFinite(depth)&&depth>0){const ratio=volume/depth;if(Math.abs(change)>35&&ratio<.5){risk+=25;notes.push('large move on thin volume');}else notes.push('volume/liquidity '+ratio.toFixed(1)+'×');}
    if(Number.isFinite(trades)&&trades>0){const oneWay=Math.max(buys,sells)/trades;if(oneWay>.9){risk+=25;notes.push('one-way trade flow');}else notes.push(buys+' buys / '+sells+' sells');}
    measured('Price & volume',risk,15,notes.length?notes.join(' · '):'Market pair indexed; detailed 24h flow unavailable',risk>=70?'RED FLAG':'CHECKED');
  }else unknown('Price & volume',15,'Price, volume and buy/sell balance are unavailable.');
  unknown('Community & hype',5,'Social data is not connected; bot followers, FOMO marketing and engagement decay are not scored.');
  unknown('Developer history',5,report.launch?.deployer?'Deployer '+report.launch.deployer+' identified; earlier projects and reputation are not indexed.':'Deployer history and linked prior launches are unavailable.');
  const factors=lenses.filter(f=>f.score!==null),coverage=factors.reduce((n,f)=>n+f.evidenceWeight,0),weight=factors.reduce((n,f)=>n+f.weight,0);if(!weight)return {score:null,coverage:0,factors:[],lenses};
  const raw=Math.round(factors.reduce((n,f)=>n+f.score*f.weight,0)/weight),redFlags=factors.filter(f=>f.status==='RED FLAG').length,score=redFlags>=2?Math.max(75,raw):redFlags===1?Math.max(55,raw):raw;
  return {score,coverage,factors,lenses,redFlags};
}
export async function readJSON(url,options={},fetcher=fetch){
  const r=await fetcher(url,{...options,signal:options.signal||AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error('Source returned HTTP '+r.status);
  const text=await r.text();if(text.length>2_000_000)throw new Error('Source response too large');return JSON.parse(text);
}
export async function analyzeToken(address,{rpcUrl=PUBLIC_RPC,fetcher=fetch,signal,pons=true}={}){
  if(!validAddress(address))throw new Error('Invalid contract address');address=address.toLowerCase();
  let id=0;
  async function rpc(method,params){const d=await readJSON(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal},fetcher);if(d.error||d.result===undefined)throw new Error('RPC read failed: '+method);return d.result;}
  const chain=await rpc('eth_chainId',[]);if(BigInt(chain)!==4663n)throw new Error('RPC is not Robinhood Chain mainnet');
  const block=await rpc('eth_blockNumber',[]);const code=await rpc('eth_getCode',[address,block]);if(!code||code==='0x')throw new Error('No contract at this address on Robinhood Chain');
  const selectors=['0x06fdde03','0x95d89b41','0x313ce567','0x18160ddd','0x8da5cb5b','0xfb7f21eb','0x665a11ca','0x7284e416'];
  const values=await Promise.allSettled(selectors.map(data=>rpc('eth_call',[{to:address,data},block])));
  const value=i=>values[i].status==='fulfilled'?values[i].value:null;
  const integer=i=>{try{return value(i)&&BigInt(value(i)).toString();}catch{return null;}};
  const decimals=integer(2),supply=integer(3);
  if(decimals===null||supply===null)throw new Error('Contract does not expose readable ERC-20 supply and decimals');
  const owner=addressResult(value(4)),liquidityPool=addressResult(value(6));
  const logo=decodeString(value(5));
  const report={address,chainId:4663,block:Number(BigInt(block)),retrievedAt:new Date().toISOString(),name:decodeString(value(0))||'Unnamed token',symbol:decodeString(value(1)),logoUrl:publicImage(logo),description:decodeString(value(7)),decimals:Number(decimals),supplyRaw:supply,supply:units(supply,decimals),contractBytes:(code.length-2)/2,owner,liquidityPool,proxyImplementation:null,contractVerification:null,contractSignals:[],activity:null,walletGraph:null,lpSafety:null,launch:null,price:null,holders:null,holderStats:null,dex:null,market:null,errors:[],riskScore:null,riskCoverage:0,riskFactors:[],riskLenses:[],survivalProbability:null,forecast:null,sources:[{name:'Robinhood Chain RPC',url:'https://robinhoodchain.blockscout.com/token/'+address}]};
  const bytecode=code.toLowerCase();if(bytecode.includes('40c10f19'))report.contractSignals.push('mint selector');if(bytecode.includes('8456cb59'))report.contractSignals.push('pause selector');if(bytecode.includes('3f4ba83a'))report.contractSignals.push('unpause selector');if(bytecode.includes('f9f92be4')||bytecode.includes('44337ea1'))report.contractSignals.push('blacklist selector');if(bytecode.includes('8a8c523c'))report.contractSignals.push('trading control selector');
  const fromBlock='0x'+Math.max(0,report.block-1500).toString(16),transferTopic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const diagnostics=await Promise.allSettled([rpc('eth_getLogs',[{address,fromBlock,toBlock:block,topics:[transferTopic]}]),rpc('eth_getStorageAt',[address,'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',block])]);
  if(diagnostics[0].status==='fulfilled'&&Array.isArray(diagnostics[0].value)){const logs=diagnostics[0].value,wallets=new Set(),edgeMap=new Map();logs.forEach(log=>{const from=addressResult(log.topics?.[1])?.toLowerCase(),to=addressResult(log.topics?.[2])?.toLowerCase();if(from)wallets.add(from);if(to)wallets.add(to);if(from&&to){const key=from+'>'+to;edgeMap.set(key,(edgeMap.get(key)||0)+1);}});report.activity={lookbackBlocks:1500,transferCount:logs.length,uniqueWallets:wallets.size,latestBlock:logs.reduce((highest,log)=>Math.max(highest,Number(BigInt(log.blockNumber))),0)||null};report.walletGraph={lookbackBlocks:1500,edges:[...edgeMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,36).map(([key,count])=>{const [from,to]=key.split('>');return{from,to,count};})};}else report.errors.push({source:'Recent transfers',status:'unavailable'});
  if(diagnostics[1].status==='fulfilled'){const implementation=addressResult(diagnostics[1].value);if(implementation&&implementation!=='0x0000000000000000000000000000000000000000')report.proxyImplementation=implementation;}
  if(pons){const results=await Promise.allSettled([...['','/price','/holders'].map(suffix=>readJSON('https://api.ponsportal.fun/token/'+address+suffix,{signal},fetcher).then(d=>{if(d.ok!==true)throw new Error(d.error||'Pons source unavailable');return d;})),readJSON('https://coins.llama.fi/prices/current/coingecko:ethereum',{signal},fetcher),readJSON('https://api.dexscreener.com/token-pairs/v1/robinhood/'+address,{signal},fetcher),readJSON('https://robinhoodchain.blockscout.com/api/v2/smart-contracts/'+address,{signal},fetcher)]);
    ['launch','price','holders'].forEach((key,i)=>{if(results[i].status==='fulfilled')report[key]=results[i].value;else report.errors.push({source:'Pons '+key,status:'unavailable'});});
    if(results.slice(0,3).some(r=>r.status==='fulfilled'))report.sources.push({name:'pons (third-party)',url:'https://docs.ponsfamily.com/'});
    const dexPairs=results[4].status==='fulfilled'&&Array.isArray(results[4].value)?results[4].value:[];const dex=dexPairs.filter(pair=>pair?.baseToken?.address?.toLowerCase()===address).sort((a,b)=>Number(b?.liquidity?.usd||0)-Number(a?.liquidity?.usd||0))[0];
    if(dex){report.dex={url:typeof dex.url==='string'?dex.url:null,pairAddress:dex.pairAddress||null,dexId:dex.dexId||null,labels:Array.isArray(dex.labels)?dex.labels.slice(0,4):[],priceUsd:Number(dex.priceUsd),marketCapUsd:Number(dex.marketCap??dex.fdv),liquidityUsd:Number(dex.liquidity?.usd),volume24hUsd:Number(dex.volume?.h24),priceChange24hPct:Number(dex.priceChange?.h24),buys24h:Number(dex.txns?.h24?.buys),sells24h:Number(dex.txns?.h24?.sells)};report.logoUrl=publicImage(dex.info?.imageUrl)||report.logoUrl;report.market={priceUsd:Number.isFinite(report.dex.priceUsd)?report.dex.priceUsd:null,marketCapUsd:Number.isFinite(report.dex.marketCapUsd)?report.dex.marketCapUsd:null,depthUsd:Number.isFinite(report.dex.liquidityUsd)?report.dex.liquidityUsd:null,depthKind:'liquidity',volume24hUsd:Number.isFinite(report.dex.volume24hUsd)?report.dex.volume24hUsd:null,priceChange24hPct:Number.isFinite(report.dex.priceChange24hPct)?report.dex.priceChange24hPct:null,buys24h:Number.isFinite(report.dex.buys24h)?report.dex.buys24h:null,sells24h:Number.isFinite(report.dex.sells24h)?report.dex.sells24h:null};report.sources.push({name:'DEX Screener',url:report.dex.url||'https://dexscreener.com/robinhood/'+address});
      if(validAddress(report.dex.pairAddress)){const pad=a=>a.toLowerCase().replace(/^0x/,'').padStart(64,'0'),poolType=report.dex.labels.join(' / ')||report.dex.dexId||'unknown pool',burnCalls=await Promise.allSettled([rpc('eth_call',[{to:report.dex.pairAddress,data:'0x18160ddd'},block]),rpc('eth_call',[{to:report.dex.pairAddress,data:'0x70a08231'+pad('0x000000000000000000000000000000000000dead')},block]),rpc('eth_call',[{to:report.dex.pairAddress,data:'0x70a08231'+pad('0x0000000000000000000000000000000000000000')},block])]);try{const total=BigInt(burnCalls[0].value),burned=BigInt(burnCalls[1].value)+BigInt(burnCalls[2].value);report.lpSafety={pairAddress:report.dex.pairAddress,poolType,totalSupplyRaw:total.toString(),burnedRaw:burned.toString(),burnedPct:pct(burned,total),lockStatus:'not_indexed'};}catch{report.lpSafety={pairAddress:report.dex.pairAddress,poolType,burnedPct:null,lockStatus:'not_indexed'};}}
    }else report.errors.push({source:'DEX Screener',status:'unavailable'});
    if(results[5].status==='fulfilled'){const verified=results[5].value;report.contractVerification={verified:verified?.is_verified===true||verified?.is_fully_verified===true,partiallyVerified:verified?.is_partially_verified===true,name:verified?.name||null,proxy:verified?.is_proxy===true};}else report.errors.push({source:'Blockscout verification',status:'unavailable'});
    const ethUsd=results[3].status==='fulfilled'?Number(results[3].value?.coins?.['coingecko:ethereum']?.price):null;
    if(Number.isFinite(ethUsd)){report.sources.push({name:'DeFiLlama ETH/USD',url:'https://defillama.com/token/ETH'});if(report.price&&!report.market){const priceEth=Number(report.price.priceEth),supplyNumber=Number(report.supply),raisedEth=Number(report.price.raisedEth);report.market={ethUsd,priceUsd:Number.isFinite(priceEth)?priceEth*ethUsd:null,marketCapUsd:Number.isFinite(priceEth*supplyNumber)?priceEth*supplyNumber*ethUsd:null,depthUsd:Number.isFinite(raisedEth)?raisedEth*ethUsd:null,depthKind:report.price.phase===0?'raised':'liquidity'};}}
    if(report.holders?.holders){const excluded=new Set(['0x0000000000000000000000000000000000000000','0x000000000000000000000000000000000000dead',report.launch?.curve?.toLowerCase(),liquidityPool?.toLowerCase(),report.dex?.pairAddress?.toLowerCase()].filter(Boolean));const distributed=report.holders.holders.filter(h=>!excluded.has(h.address.toLowerCase())&&BigInt(h.balance)>0n),distributedSupply=distributed.reduce((n,h)=>n+BigInt(h.balance),0n),top10=distributed.slice(0,10).reduce((n,h)=>n+BigInt(h.balance),0n),exact=!report.holders.next_page_params;report.holderStats={count:distributed.length,countLabel:String(distributed.length)+(exact?'':'+'),exact,top10Pct:pct(top10,distributedSupply),distributedSupply:distributedSupply.toString(),topHolders:distributed.slice(0,12).map(h=>({address:h.address.toLowerCase(),sharePct:pct(BigInt(h.balance),distributedSupply)}))};}
  }
  report.evidence=[{title:'ERC-20 contract read at block '+report.block,detail:'Supply: '+report.supply+' '+(report.symbol||'tokens')+'. Presence on Robinhood Chain is not proof of a Robinhood Markets listing, approval or compliance review.'},{title:owner?'owner() returned '+owner:'owner() is unavailable',detail:owner==='0x0000000000000000000000000000000000000000'?'Zero owner does not rule out roles, proxy control or hidden privileges.':'A complete permissions audit requires verified source code and proxy/role checks.'}];
  if(report.contractVerification)report.evidence.push({title:report.contractVerification.verified?'Source code is verified in Blockscout':'Source code is not verified in Blockscout',detail:report.contractVerification.verified?'Readable source improves inspection, but does not by itself prove safety.':'Critical permissions cannot be fully audited without readable verified source.'});
  if(report.launch)report.evidence.push({title:'Pons Portal reports a launch record',detail:'Creator tax: '+(Number(report.launch.creatorTaxBps)/100)+'%. Third-party data; not independently verified.'});
  if(report.holderStats)report.evidence.push({title:report.holderStats.countLabel+' distributed holder'+(report.holderStats.count===1?'':'s')+' in the available index',detail:'Top 10 distributed addresses hold '+(report.holderStats.top10Pct?.toFixed(2)??'unknown')+'%. Known curve, pool, zero and burn addresses are excluded.'});
  if(report.lpSafety)report.evidence.push({title:Number.isFinite(report.lpSafety.burnedPct)?report.lpSafety.burnedPct.toFixed(2)+'% of readable LP supply is burned':'LP burn amount is unreadable',detail:'Pair '+report.lpSafety.pairAddress+'. External locker contracts and unlock dates are not yet indexed.'});
  const scored=scoreReport(report);report.riskScore=scored.score;report.riskCoverage=scored.coverage;report.riskFactors=scored.factors;report.riskLenses=scored.lenses;report.lensCoverage=Math.round(scored.lenses.filter(l=>l.score!==null).length/6*100);
  return report;
}
