// Routenplanung: Auswahl der Stopps (Luftlinie) und Zeitplan (mit echten Etappen, sobald vorhanden)
(function(){
const R=6371;
function dist(a,b){const toR=x=>x*Math.PI/180;const dLat=toR(b.lat-a.lat),dLon=toR(b.lon-a.lon);const s=Math.sin(dLat/2)**2+Math.cos(toR(a.lat))*Math.cos(toR(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(s));}
const DETOUR=1.35;
function walkKm(a,b){return dist(a,b)*DETOUR;}
function bearing(a,b){const toR=x=>x*Math.PI/180;const y=Math.sin(toR(b.lon-a.lon))*Math.cos(toR(b.lat));const x=Math.cos(toR(a.lat))*Math.sin(toR(b.lat))-Math.sin(toR(a.lat))*Math.cos(toR(b.lat))*Math.cos(toR(b.lon-a.lon));return Math.atan2(y,x);}
function turn(a,b,c){let d=bearing(b,c)-bearing(a,b);while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return Math.abs(d);}
const hhmm=h=>{const m=Math.round(h*60);return String(Math.floor(m/60)%24).padStart(2,"0")+":"+String(m%60).padStart(2,"0");};
const parseT=s=>{const [h,m]=String(s).split(":").map(Number);return h+(m||0)/60;};
const fmtKm=k=>k.toFixed(1).replace(".",",")+" km";
const fmtMin=m=>{m=Math.round(m);return m>=60?Math.floor(m/60)+" h "+String(m%60).padStart(2,"0")+" min":m+" min";};

function openStatus(p,dow,t){
  if(p.closed&&p.closed.includes(dow))return {s:"closed"};
  if(!p.hours)return {s:"unknown"};
  const slots=p.hours[dow];
  if(!slots)return {s:"closed"};
  for(const [o,c] of slots){if(t>=o&&t<=c)return {s:"open",close:c};}
  const later=slots.map(x=>x[0]).filter(o=>o>t).sort((a,b)=>a-b)[0];
  return later!==undefined?{s:"later",opens:later}:{s:"closed"};
}

// Stopps auswählen → Liste von {p, role}
function selectRoute(opts,places){
  const {start,end,returnMode,nStops,nSights,stay,pace,interests,dow,startTime,lastTime,exclude=[],jitter=0}=opts;
  const inter=new Set(interests);const ex=new Set(exclude);
  const einkehr=places.filter(p=>(p.kind==="buschenschank"||p.kind==="gasthaus")&&p.id!==start.id&&p.id!==end.id&&!ex.has(p.id));
  const sights=places.filter(p=>p.kind==="sight"&&p.id!==start.id&&p.id!==end.id&&!ex.has(p.id));
  const scoreP=p=>{let s=1;for(const t of p.tags||[])if(inter.has(t))s+=.6;if(p.kind==="gasthaus")s-=.3;if(p.verified)s+=.2;return s;};
  const windowH=lastTime-startTime;const warnings=[];
  const sightStay=(nSights*15)/60;
  const walkBudget=()=>Math.max(0,windowH-Math.max(0,nStops-1)*(stay/60)-sightStay);
  let chain=[];let cur=start;let prev=null;let usedKm=0;
  const pool=einkehr.filter(p=>!(p.closed&&p.closed.includes(dow))&&!(p.hours&&!p.hours[dow]));
  const excluded=einkehr.length-pool.length;
  if(excluded)warnings.push(excluded+" Betrieb(e) haben am gewählten Tag Ruhetag und wurden ausgelassen.");
  for(let i=0;i<nStops;i++){
    const remaining=nStops-i-1;const budget=walkBudget();
    let best=null,bestS=-1e9;
    for(const p of pool){
      if(chain.includes(p))continue;
      const km=walkKm(cur,p);if(km<0.5)continue;
      const backKm=returnMode==="taxi"?0:walkKm(p,end);
      const projected=usedKm+km+backKm+remaining*0.9;
      if(projected>budget*pace*1.02)continue;
      let s=scoreP(p);
      const ideal=Math.min(4.5,Math.max(2,(budget*pace-usedKm-backKm)/(remaining+1)));
      s-=Math.abs(km-ideal)*0.35;
      if(prev){const tr=turn(prev,cur,p);if(tr>Math.PI*0.6)s-=(tr-Math.PI*0.6)*1.2;}
      if(returnMode!=="taxi"&&remaining===0)s-=backKm*0.25;
      const arrive=startTime+(usedKm+km)/pace+i*(stay/60)+Math.min(i,nSights)*0.25;
      const st=openStatus(p,dow,arrive);
      if(st.s==="later"&&st.opens-arrive>0.75)s-=1.5;
      if(st.s==="closed")s-=3;
      if(jitter)s+=(Math.random()-0.5)*jitter;
      if(s>bestS){bestS=s;best=p;}
    }
    if(!best)break;
    chain.push(best);usedKm+=walkKm(cur,best);prev=cur;cur=best;
  }
  if(chain.length<nStops)warnings.push("Im Zeitfenster gehen sich "+chain.length+" statt "+nStops+" Einkehren aus.");
  const nodes=[start,...chain];if(returnMode!=="taxi")nodes.push(end);
  const route=nodes.map(n=>({p:n,role:n===start?"start":(n===end&&returnMode!=="taxi"?"end":"stop")}));
  let added=0;const usedS=new Set();
  while(added<nSights){
    let best=null;
    for(let i=0;i<route.length-1;i++){
      const a=route[i].p,b=route[i+1].p;const base=walkKm(a,b);
      for(const s of sights){
        if(usedS.has(s.id))continue;
        const det=walkKm(a,s)+walkKm(s,b)-base;if(det>1.2)continue;
        const v=scoreP(s)-det*1.1;if(!best||v>best.v)best={v,i,s};
      }
    }
    if(!best||best.v<0.4)break;
    route.splice(best.i+1,0,{p:best.s,role:"sight"});usedS.add(best.s.id);added++;
  }
  return {route,warnings};
}

// Luftlinien-Etappen als Rückfall
function airLegs(route,pace){
  const legs=[];
  for(let i=1;i<route.length;i++){const km=walkKm(route[i-1].p,route[i].p);legs.push({km,min:km/pace*60,ascent:null,estimated:true});}
  return legs;
}

// Zeitplan an das Zeitfenster anpassen. legs[i] gehört zur Etappe route[i] → route[i+1].
// Gibt {items, km, walkMin, restMin, stayUsed, lastStop, warnings, dropped} – dropped=true, wenn ein Stopp gestrichen werden sollte (dann neu routen).
function schedule(route,legs,opts){
  const {stay,dow,startTime,lastTime}=opts;const warnings=[];
  const build=(stayMin)=>{
    let t=startTime;const out=[];let km=0,walk=0,rest=0;
    for(let i=0;i<route.length;i++){
      const r=route[i];const e={...r};
      if(i>0){const l=legs[i-1];km+=l.km;walk+=l.min;t+=l.min/60;e.leg=l;}
      e.arrive=t;let s=0;
      if(r.role==="stop")s=stayMin/60;else if(r.role==="sight")s=(r.p.stay||10)/60;
      e.stay=s;e.depart=t+s;rest+=s;e.open=r.role==="stop"?openStatus(r.p,dow,t):null;
      out.push(e);t=e.depart;
    }
    return {items:out,km,walkMin:walk,restMin:rest*60,endT:t};
  };
  let st=stay;let sched=build(st);
  const lastStop=s=>{for(let i=s.items.length-1;i>=0;i--)if(s.items[i].role==="stop")return s.items[i];return null;};
  let dropped=false;
  while(lastStop(sched)&&lastStop(sched).arrive>lastTime+0.02&&st>40){st-=5;sched=build(st);}
  if(lastStop(sched)&&lastStop(sched).arrive>lastTime+0.02){dropped=true;}
  if(st!==stay&&!dropped)warnings.push("Einkehrdauer auf "+st+" min verkürzt, damit das Zeitfenster passt.");
  let ls=lastStop(sched);
  if(!dropped&&ls&&lastTime-ls.arrive>0.25){
    const nBefore=route.filter(r=>r.role==="stop").length-1;
    if(nBefore>0){const extra=Math.min(90-st,Math.floor((lastTime-ls.arrive)*60/nBefore));if(extra>0){st+=extra;sched=build(st);warnings.push("Einkehrdauer auf "+st+" min verlängert, damit die letzte Einkehr um etwa "+hhmm(lastTime)+" liegt.");}}
  }
  ls=lastStop(sched);
  for(const it of sched.items)if(it.open&&it.open.s==="closed")warnings.push(it.p.name+" ist zur Ankunftszeit geschlossen – bitte Alternative wählen.");
  const ascent=legs.reduce((a,l)=>a+(l.ascent||0),0);
  return {items:sched.items,km:sched.km,walkMin:sched.walkMin,restMin:sched.restMin,stayUsed:st,endT:sched.endT,lastStop:ls,warnings:[...new Set(warnings)],dropped,ascent,estimated:legs.some(l=>l.estimated)};
}

// Letzten Einkehr-Stopp entfernen (wenn das Zeitfenster trotz Kürzung nicht reicht)
function dropLastStop(route){
  const idx=route.map((r,i)=>r.role==="stop"?i:-1).filter(i=>i>=0);
  if(idx.length<=1)return false;
  route.splice(idx[idx.length-1],1);
  // Wegpunkt am Ende ohne folgende Einkehr entfernen
  while(route.length&&route[route.length-1].role==="sight")route.pop();
  return true;
}

// Beste Einfügeposition (kleinster Umweg) für einen neuen Stopp
function bestInsertIndex(route,p){
  let best=1,bestDet=Infinity;
  for(let i=0;i<route.length-1;i++){
    const a=route[i].p,b=route[i+1].p;const det=walkKm(a,p)+walkKm(p,b)-walkKm(a,b);
    if(det<bestDet){bestDet=det;best=i+1;}
  }
  // Bei Weintaxi-Rückfahrt darf der Stopp auch ans Ende
  const last=route[route.length-1];
  if(last.role!=="end"){const det=walkKm(last.p,p);if(det<bestDet){best=route.length;}}
  return best;
}
window.Planner={dist,walkKm,hhmm,parseT,fmtKm,fmtMin,openStatus,selectRoute,airLegs,schedule,dropLastStop,bestInsertIndex};
})();
