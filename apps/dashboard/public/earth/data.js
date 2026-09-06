export const COLORS = { research:'#368eff', development:'#3be77c', verification:'#21e5f5', design:'#a575ff', automation:'#ffab49', analysis:'#ff6969', other:'#ffd668' };
export const arrayOf = (value, key) => Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : [];
export function hash(text) { let h=2166136261; for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);} return h>>>0; }
export function capabilityType(caps) {
  const names=caps.map(c=>typeof c==='string'?c:c?.name||'').join(' ').toLowerCase();
  for(const [type,pattern] of [['development',/coding|develop|program|software/],['verification',/verif|audit/],['design',/design|creative/],['automation',/automat|workflow/],['research',/research|discovery/],['analysis',/analys|data/]]) if(pattern.test(names)) return type;
  return 'other';
}
export function classify(record, registry, kind='agent') {
  const explicit=String(record?.classification||record?.provenance?.classification||record?.input?.classification||'').toLowerCase();
  if(record?.input?.program==='genesis-work-pool') return {key:'genesis',label:'Genesis · promotional',reason:'Genesis work-pool metadata; excluded from organic adoption.'};
  if(['internal','test','canary','promotional','genesis'].includes(explicit)) return {key:explicit,label:explicit==='canary'?'Test · canary':explicit[0].toUpperCase()+explicit.slice(1),reason:'Classification supplied by the public API.'};
  if(kind==='agent' && arrayOf(registry?.verifiedOrganicOperators).some(x=>x.agentId===record.id)) return {key:'organic',label:'Verified independent',reason:'Verified independent-operator registry.'};
  if(kind==='agent' && arrayOf(registry?.internalAgentIds).includes(record.id)) return {key:'internal',label:'Internal',reason:'Internal-agent registry.'};
  if(kind==='agent' && /\btest\b|\bcanary\b/i.test(record?.name||'')) return {key:'test',label:'Test · name-derived',reason:'Conservative display classification from the agent name; not an ownership verification.'};
  if(explicit==='organic') return {key:'organic',label:'Organic',reason:'Classification supplied by the public API.'};
  if(explicit==='external') return {key:'external',label:'External · unverified',reason:'External classification is not independent-operation verification.'};
  return {key:'unclassified',label:'Unclassified',reason:'No verified classification was supplied; not counted as organic.'};
}
export function normalizeAgents(directory, graph, registry) {
  const graphAgents=arrayOf(graph?.nodes).filter(n=>n.type==='agent');
  const source=directory===null?graphAgents.map(n=>({...n,name:n.label})):arrayOf(directory,'agents');
  const graphMap=new Map(graphAgents.map(n=>[n.id,n]));
  return source.filter(a=>a?.id).map(a=>{
    const capabilities=arrayOf(a.capabilities).map(c=>typeof c==='string'?c:c?.name).filter(Boolean);
    return {...a,name:a.name||a.label||a.id,capabilities,type:capabilityType(capabilities),classificationInfo:classify(a,registry),reputation:a.reputation||graphMap.get(a.id)?.reputation||null};
  });
}
// Render only actual creator/worker assignments or contract hires. Never connect
// adjacent visual markers or guess relationships from similar capabilities.
export function relationships(agents,jobs,graph) {
  const ids=new Set(agents.map(a=>a.id)), links=new Map();
  const add=(from,to,recordId,type)=>{if(from!==to&&ids.has(from)&&ids.has(to))links.set(`${from}:${to}:${recordId}`,{from,to,recordId,type});};
  for(const j of arrayOf(jobs,'jobs')) if(j.workerId) add(j.creatorId,j.workerId,j.id,'Assigned job');
  const edges=arrayOf(graph?.edges);
  for(const e of edges) if(e.type==='HIRED_UNDER') {
    const worker=edges.find(w=>w.type==='WORKER'&&w.from===e.to);
    if(worker) add(e.from,worker.to,e.to,'Contract');
  }
  // Prefer one connection per pair on the visual globe. Full evidence is retained in the graph page.
  return [...new Map([...links.values()].map(l=>[`${l.from}:${l.to}`,l])).values()];
}
export function metrics(stats,growth,jobs) {
  return {independent:growth?.verifiedOrganic?.independentAgents??null,open:jobs===null?null:arrayOf(jobs,'jobs').filter(j=>j.status==='OPEN').length,completed:stats?.jobsCompleted??null,settled:stats?.a2aTransactions??null};
}
export const validHash = value => /^0x[0-9a-fA-F]{64}$/.test(String(value||''));
export async function getJson(url) {
  const response=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  if(!response.headers.get('content-type')?.includes('json')) throw new Error('Expected JSON');
  return response.json();
}
