/* Weinweg Südsteiermark – App-Logik (Formular, OSM-Abgleich, Routing, Karte, GPS, Unterwegs-Modus, Routenbearbeitung, Wetter) */
(function(){
const C=window.WW_CONFIG;const P=window.Planner;
const {hhmm,parseT,fmtKm,fmtMin}=P;
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const webUrl=w=>/^https?:/.test(w)?w:"https://"+w;
const webLabel=w=>w.replace(/^https?:\/\/(www\.)?/,"").split("/")[0];
const linkHtml=p=>(p.web?'<a href="'+esc(webUrl(p.web))+'" target="_blank" rel="noopener">'+esc(webLabel(p.web))+'</a>':'')+(p.phone?(p.web?' · ':'')+'<a href="tel:'+esc(String(p.phone).replace(/\s/g,""))+'">'+esc(p.phone)+'</a>':'');
const DOWN=["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const isoDate=d=>{const z=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate());};

// ---------- lokale Daten ----------
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
let CUSTOM=store.get("ww.custom",[]);let OVERRIDES=store.get("ww.over",{});let OSM=store.get("ww.osm",null);let SAVED=store.get("ww.saved",[]);
let STARTS=[];            // temporäre Startpunkte (Suche, GPS)
let DONE=new Set();       // erledigte Stopps (Unterwegs-Modus)
let current=null;         // {res, opts, route, legs, geometry, warnings}
let mePos=null;let WX=null;let pendingInsert=null; // Einfügeposition beim Tauschen

function allPlaces(){
  const osmExtra=(OSM&&OSM.extra)||[];const snap=(OSM&&OSM.snap)||{};
  const seed=SEED_PLACES.map(p=>{let q={...p};if(snap[p.id])q={...q,...snap[p.id],verified:true};if(OVERRIDES[p.id])q={...q,...OVERRIDES[p.id]};return q;});
  const extra=osmExtra.filter(e=>!OVERRIDES[e.id]||!OVERRIDES[e.id].hidden).map(e=>OVERRIDES[e.id]?{...e,...OVERRIDES[e.id]}:e);
  return [...seed,...extra,...CUSTOM,...STARTS];
}
const byId=id=>allPlaces().find(p=>p.id===id);
const inRoute=id=>!!(current&&current.route.some(r=>r.p.id===id&&(r.role==="stop"||r.role==="sight")));

// ---------- UI-Helfer ----------
const toastEl=$("#toast");let toastT;
function toast(m){toastEl.textContent=m;toastEl.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>toastEl.classList.remove("show"),2200);}
async function copy(text){try{await navigator.clipboard.writeText(text);toast("Kopiert");}catch(e){toast("Kopieren nicht möglich");}}
const tabs=[...document.querySelectorAll('[role="tab"]')];
function showTab(id){for(const t of tabs){const on=t.id===id;t.setAttribute("aria-selected",on);document.getElementById(t.getAttribute("aria-controls")).hidden=!on;}window.scrollTo({top:0});if(id==="tab-map"&&map){setTimeout(()=>{map.invalidateSize();if(current)fitRoute();},80);}if(id==="tab-places")renderPlaces();}
tabs.forEach(t=>t.addEventListener("click",()=>showTab(t.id)));
window.addEventListener("resize",()=>{if(map)map.invalidateSize();});

// ---------- Formular ----------
function fillSelects(){
  const ps=allPlaces();
  const opts=ps.filter(p=>p.kind!=="sight").sort((a,b)=>(a.kind==="start"?0:1)-(b.kind==="start"?0:1)||a.name.localeCompare(b.name,"de"));
  for(const sel of [$("#start"),$("#end")]){const v=sel.value;sel.innerHTML="";for(const p of opts){const o=document.createElement("option");o.value=p.id;o.textContent=p.name;sel.appendChild(o);}sel.value=v;if(!sel.value)sel.value=sel.id==="start"?"ehrenhausen":"gamlitz";}
}
fillSelects();
$("#date").value=isoDate(new Date());
document.querySelectorAll("[data-step]").forEach(b=>b.addEventListener("click",()=>{const inp=document.getElementById(b.dataset.step);let v=+inp.value+(+b.dataset.d);const max=b.dataset.step==="nStops"?8:6;v=Math.max(b.dataset.step==="nStops"?1:0,Math.min(max,v));inp.value=v;document.getElementById(b.dataset.step+"Out").value=v;}));
document.querySelectorAll("#interests .chip input").forEach(i=>i.addEventListener("change",()=>i.parentElement.dataset.on=i.checked?"1":"0"));
document.querySelectorAll('input[name="ret"]').forEach(r=>r.addEventListener("change",()=>{$("#endWrap").hidden=document.querySelector('input[name="ret"]:checked').value!=="end";}));

function readOpts(){
  const ps=allPlaces();
  const start=byId($("#start").value)||ps[0];
  const returnMode=document.querySelector('input[name="ret"]:checked').value;
  const end=returnMode==="end"?(byId($("#end").value)||start):start;
  const date=new Date($("#date").value+"T12:00:00");
  return {start,end,returnMode,nStops:+$("#nStops").value,nSights:+$("#nSights").value,stay:+$("#stay").value,pace:+$("#pace").value,
    interests:[...document.querySelectorAll("#interests input:checked")].map(i=>i.value),dow:isNaN(date)?new Date().getDay():date.getDay(),
    startTime:parseT($("#startTime").value||"10:00"),lastTime:parseT($("#lastTime").value||"18:00"),date:isNaN(date)?new Date():date,exclude:[]};
}
function writeOpts(o){
  $("#date").value=isoDate(o.date);$("#startTime").value=hhmm(o.startTime);$("#lastTime").value=hhmm(o.lastTime);
  $("#nStops").value=o.nStops;$("#nStopsOut").value=o.nStops;$("#nSights").value=o.nSights;$("#nSightsOut").value=o.nSights;
  $("#stay").value=o.stay;$("#pace").value=o.pace;
  document.querySelectorAll("#interests input").forEach(i=>{i.checked=o.interests.includes(i.value);i.parentElement.dataset.on=i.checked?"1":"0";});
  const r=document.querySelector('input[name="ret"][value="'+o.returnMode+'"]');if(r){r.checked=true;$("#endWrap").hidden=o.returnMode!=="end";}
  if(byId(o.start.id))$("#start").value=o.start.id;if(o.returnMode==="end"&&o.end&&byId(o.end.id))$("#end").value=o.end.id;
}

// ---------- Geocoding (Nominatim) ----------
async function geocode(q){
  const [s,w,n,e]=C.BBOX;
  const url=C.NOMINATIM_URL+"?format=jsonv2&limit=5&countrycodes=at&accept-language=de&viewbox="+(w-0.2)+","+(n+0.1)+","+(e+0.2)+","+(s-0.1)+"&q="+encodeURIComponent(q);
  const r=await fetch(url,{headers:{"Accept":"application/json"}});
  if(!r.ok)throw new Error("Nominatim "+r.status);
  return r.json();
}
function addStart(name,lat,lon){
  const id="start-"+Date.now();const p={id,name,kind:"start",tags:[],lat,lon,addr:"",temp:true};
  STARTS.push(p);fillSelects();$("#start").value=id;return p;
}
$("#geoBtn").addEventListener("click",async()=>{
  const q=$("#geoQ").value.trim();if(!q)return;const box=$("#geoResults");box.hidden=false;box.innerHTML='<p class="notice">Suche…</p>';
  try{const hits=await geocode(q);
    if(!hits.length){box.innerHTML='<p class="notice">Nichts gefunden – anders schreiben oder Ort ergänzen (z. B. „Gamlitz“).</p>';return;}
    box.innerHTML=hits.map((h,i)=>'<label><input type="radio" name="geo" value="'+i+'"><span>'+esc(h.display_name.split(",").slice(0,3).join(", "))+'<small>'+esc(h.display_name)+'</small></span></label>').join("");
    box.querySelectorAll("input").forEach(inp=>inp.addEventListener("change",()=>{const h=hits[+inp.value];addStart(h.display_name.split(",")[0],+h.lat,+h.lon);box.hidden=true;$("#geoQ").value="";toast("Startpunkt gesetzt");}));
  }catch(e){box.innerHTML='<p class="notice">Suche nicht erreichbar ('+esc(e.message)+').</p>';}
});
$("#geoQ").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("#geoBtn").click();}});

// ---------- GPS ----------
function getPosition(){return new Promise((res,rej)=>{if(!navigator.geolocation)return rej(new Error("Kein GPS im Browser"));navigator.geolocation.getCurrentPosition(p=>res(p.coords),e=>rej(new Error(e.code===1?"Standortfreigabe abgelehnt":"Standort nicht verfügbar")),{enableHighAccuracy:true,timeout:12000,maximumAge:30000});});}
$("#gpsStart").addEventListener("click",async()=>{try{const c=await getPosition();mePos={lat:c.latitude,lon:c.longitude};STARTS=STARTS.filter(s=>s.id!=="gps");STARTS.push({id:"gps",name:"Mein Standort",kind:"start",tags:[],lat:c.latitude,lon:c.longitude,addr:"GPS",temp:true});fillSelects();$("#start").value="gps";toast("Standort als Start gesetzt");updateMe();}catch(e){toast(e.message);}});

// ---------- OpenStreetMap-Abgleich (Overpass) ----------
const norm=s=>String(s).toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").replace(/[^a-z0-9 ]+/g," ").replace(/\b(buschenschank|buschenschenke|buschenschanke|weingut|weinhof|weinbau|familie|fam|heuriger|heurigen|gasthaus|gasthof|restaurant|hotel|cafe|das|kleine|wirtshaus|vorm|am|der|die|und|by|an|weinstrasse)\b/g," ").replace(/\s+/g," ").trim();
async function loadOSM(force){
  const status=$("#dataStatus");
  if(!force&&OSM&&OSM.ts&&Date.now()-OSM.ts<C.OSM_CACHE_DAYS*864e5){status.textContent="Betriebsdaten: "+Object.keys(OSM.snap||{}).length+" Betriebe über OpenStreetMap verortet, "+(OSM.extra||[]).length+" weitere Einträge aus OSM.";return;}
  const [s,w,n,e]=C.BBOX;const bb="("+s+","+w+","+n+","+e+")";
  const q='[out:json][timeout:25];(nwr["name"~"Buschenschank|Buschenschenke",i]'+bb+';nwr["cuisine"~"buschenschank|heuriger",i]'+bb+';nwr["amenity"~"restaurant|cafe|pub"]["name"~"Weingut|Weinhof|Buschenschank",i]'+bb+';nwr["tourism"="viewpoint"]'+bb+';nwr["historic"~"castle|chapel|monument|memorial|ruins",i]["name"]'+bb+';nwr["amenity"="place_of_worship"]["name"]'+bb+';nwr["man_made"="tower"]["name"]'+bb+';);out center tags;';
  try{
    status.textContent="Betriebsdaten werden mit OpenStreetMap abgeglichen…";
    const r=await fetch(C.OVERPASS_URL,{method:"POST",body:"data="+encodeURIComponent(q),headers:{"Content-Type":"application/x-www-form-urlencoded"}});
    if(!r.ok)throw new Error("Overpass "+r.status);
    const data=await r.json();
    const snap={};const extra=[];const seedNorm=SEED_PLACES.filter(p=>p.kind!=="start").map(p=>({p,toks:norm(p.name).split(" ").filter(t=>t.length>=4)}));
    for(const el of data.elements||[]){
      const t=el.tags||{};if(!t.name)continue;const lat=el.lat??(el.center&&el.center.lat),lon=el.lon??(el.center&&el.center.lon);if(lat==null)continue;
      const nn=norm(t.name);let matched=null;
      for(const s of seedNorm){if(s.toks.some(tok=>nn.includes(tok))&&P.dist(s.p,{lat,lon})<5){matched=s.p;break;}}
      const info={};if(t.phone||t["contact:phone"])info.phone=t.phone||t["contact:phone"];if(t.website||t["contact:website"])info.web=t.website||t["contact:website"];if(t.opening_hours)info.oh=t.opening_hours;
      if(matched){if(!snap[matched.id])snap[matched.id]={lat,lon,...info};continue;}
      const isB=/buschensch/i.test(t.name)||/buschenschank|heuriger/i.test(t.cuisine||"");
      let kind=null,tags=[];
      if(isB){kind="buschenschank";tags=["kulinarik"];}
      else if(/weingut|weinhof/i.test(t.name)&&t.amenity){kind="gasthaus";tags=["kulinarik"];}
      else if(t.tourism==="viewpoint"){kind="sight";tags=["aussicht","natur"];}
      else if(t.man_made==="tower"){kind="sight";tags=["aussicht"];}
      else if(t.historic||t.amenity==="place_of_worship"){kind="sight";tags=["kultur"];}
      if(!kind)continue;
      const addr=[t["addr:street"]||t["addr:place"],t["addr:housenumber"]].filter(Boolean).join(" ")+(t["addr:city"]?", "+t["addr:city"]:"");
      extra.push({id:"osm-"+el.type+el.id,name:t.name,kind,tags,lat,lon,addr,stay:kind==="sight"?10:undefined,source:"osm",...info});
    }
    OSM={ts:Date.now(),snap,extra};store.set("ww.osm",OSM);
    status.textContent="Betriebsdaten: "+Object.keys(snap).length+" Betriebe über OpenStreetMap verortet, "+extra.length+" weitere Einträge aus OSM.";
    fillSelects();renderPlaces();drawAllPlaces();
  }catch(e){status.textContent="OpenStreetMap gerade nicht erreichbar – es werden die gespeicherten Standorte verwendet.";}
}

// ---------- Wetter (open-meteo) ----------
async function loadWeather(lat,lon,date){
  const d=isoDate(date);const key=d+"|"+lat.toFixed(2)+"|"+lon.toFixed(2);
  if(WX&&WX.key===key)return WX;
  const url="https://api.open-meteo.com/v1/forecast?latitude="+lat.toFixed(3)+"&longitude="+lon.toFixed(3)+"&hourly=temperature_2m,precipitation_probability,weather_code&daily=sunset,sunrise&timezone=Europe%2FVienna&start_date="+d+"&end_date="+d;
  try{const r=await fetch(url);if(!r.ok)throw new Error("wx");const j=await r.json();
    const sunset=j.daily&&j.daily.sunset&&j.daily.sunset[0]?parseT(j.daily.sunset[0].slice(11,16)):null;
    WX={key,hourly:j.hourly,sunset};return WX;}catch(e){WX={key,hourly:null,sunset:null};return WX;}
}
const WXICON=c=>c==null?"":c<=1?"☀️":c<=3?"⛅":c<=48?"🌫️":c<=67?"🌧️":c<=77?"🌨️":c<=82?"🌦️":"⛈️";
function wxAt(h){if(!WX||!WX.hourly)return null;const i=Math.max(0,Math.min(23,Math.round(h)));return {t:WX.hourly.temperature_2m[i],p:WX.hourly.precipitation_probability[i],c:WX.hourly.weather_code[i]};}

// ---------- Routing (Supabase-Funktion → openrouteservice) ----------
async function orsRoute(points){
  if(!C.ROUTE_URL)return null;
  const body={coordinates:points.map(p=>[+p.lon.toFixed(6),+p.lat.toFixed(6)])};
  const r=await fetch(C.ROUTE_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok){let msg="";try{msg=(await r.json()).error?.message||(await r.json()).error||"";}catch(e){}throw new Error("Routing "+r.status+(msg?": "+msg:""));}
  const g=await r.json();const f=g.features&&g.features[0];if(!f)throw new Error("Routing: keine Route");
  const pr=f.properties||{};
  return {geometry:f.geometry.coordinates.map(c=>[c[1],c[0],c[2]]),segments:pr.segments,wayPoints:pr.way_points,summary:pr.summary};
}
// Etappen aus der ORS-Antwort: aus den Wegpunkt-Indizes der Geometrie berechnet (robust, auch ohne "segments")
function legsFromORS(ors,pace){
  const g=ors.geometry;const wp=ors.wayPoints;
  if(Array.isArray(wp)&&wp.length>=2&&g&&g.length){
    const legs=[];
    for(let k=1;k<wp.length;k++){
      let km=0,asc=0,desc=0;
      for(let i=Math.max(1,wp[k-1]+1);i<=Math.min(wp[k],g.length-1);i++){
        km+=P.dist({lat:g[i-1][0],lon:g[i-1][1]},{lat:g[i][0],lon:g[i][1]});
        const dz=(g[i][2]??0)-(g[i-1][2]??0);if(g[i][2]!=null&&g[i-1][2]!=null){if(dz>0)asc+=dz;else desc-=dz;}
      }
      legs.push({km,min:km/pace*60+asc/10,ascent:Math.round(asc),descent:Math.round(desc),estimated:false});
    }
    return legs;
  }
  if(Array.isArray(ors.segments))return ors.segments.map(s=>{const km=s.distance>50?s.distance/1000:s.distance;const asc=s.ascent||0;return {km,min:km/pace*60+asc/10,ascent:asc,descent:s.descent||0,estimated:false};});
  throw new Error("Antwort ohne Etappen");
}

// ---------- Planen ----------
async function finishPlan(route,opts,baseWarnings,allowDrop){
  // 1) Schnelle Vorschau mit Luftlinie
  let legs=P.airLegs(route,opts.pace);let res=P.schedule(route,legs,opts);
  if(allowDrop)while(res.dropped&&P.dropLastStop(route)){legs=P.airLegs(route,opts.pace);res=P.schedule(route,legs,opts);baseWarnings.push("Eine Einkehr wurde gestrichen, damit die letzte Einkehr bis "+hhmm(opts.lastTime)+" erreicht wird.");}
  current={res,opts,route,legs,geometry:null,warnings:[...baseWarnings,...res.warnings]};
  renderRoute(current);drawRoute(current);updateHash();
  loadWeather(opts.start.lat,opts.start.lon,opts.date).then(()=>{if(current)renderRoute(current);});
  // 2) Echte Wege nachladen
  if(!C.ROUTE_URL){current.warnings.push("Kein Routing-Dienst hinterlegt – Gehzeiten aus Luftlinie geschätzt.");renderRoute(current);return;}
  $("#mapStatus").textContent="Wege werden berechnet…";
  try{
    for(let round=0;round<3;round++){
      const ors=await orsRoute(route.map(r=>r.p));
      legs=legsFromORS(ors,opts.pace);res=P.schedule(route,legs,opts);
      current={res,opts,route,legs,geometry:ors.geometry,warnings:[...baseWarnings,...res.warnings]};
      if(allowDrop&&res.dropped&&P.dropLastStop(route)){baseWarnings.push("Eine Einkehr wurde gestrichen, damit die letzte Einkehr bis "+hhmm(opts.lastTime)+" erreicht wird.");continue;}
      break;
    }
    $("#mapStatus").textContent="";renderRoute(current);drawRoute(current);
  }catch(e){$("#mapStatus").textContent="";current.warnings.push("Routing nicht verfügbar ("+e.message+") – Gehzeiten geschätzt.");renderRoute(current);}
}
async function runPlan(opts){
  const {route,warnings}=P.selectRoute(opts,allPlaces());
  if(route.length<2){renderRoute(null);return;}
  await finishPlan(route,opts,warnings,true);
}
// Manuelle Änderung: Route neu bewerten, nichts automatisch streichen
async function recompute(){
  if(!current)return;const w=[];
  const stops=current.route.filter(r=>r.role==="stop").length;
  await finishPlan(current.route,{...current.opts,nStops:stops},w,false);
  const ls=current.res.lastStop;
  if(ls&&ls.arrive>current.opts.lastTime+0.02){current.warnings.push("Die letzte Einkehr liegt "+fmtMin((ls.arrive-current.opts.lastTime)*60)+" nach "+hhmm(current.opts.lastTime)+" – einen Stopp entfernen oder Zeitfenster verlängern.");renderRoute(current);}
}
$("#planBtn").addEventListener("click",()=>{$("#sharePanel").hidden=true;const o=readOpts();if(o.lastTime<=o.startTime){toast("Die letzte Einkehr muss nach dem Start liegen");return;}DONE=new Set();pendingInsert=null;runPlan(o);showTab("tab-route");});

// Routenbearbeitung
function removeStop(id){
  if(!current)return;const i=current.route.findIndex(r=>r.p.id===id&&(r.role==="stop"||r.role==="sight"));if(i<0)return;
  current.route.splice(i,1);DONE.delete(id);recompute();toast("Aus Route entfernt");
}
function addStop(p,mode){ // mode: "best" | "next" | {index}
  if(!current){toast("Zuerst eine Route planen");return;}
  if(inRoute(p.id)){toast("Ist schon in der Route");return;}
  const role=p.kind==="sight"?"sight":"stop";const node={p,role};
  let idx;
  if(mode&&typeof mode==="object")idx=Math.min(mode.index,current.route.length);
  else if(mode==="next"){const lastStop=current.route.map((r,i)=>r.role==="stop"||r.role==="sight"?i:-1).filter(i=>i>=0).pop();idx=(lastStop==null?0:lastStop)+1;if(current.route[current.route.length-1].role==="end"&&idx>current.route.length-1)idx=current.route.length-1;}
  else idx=P.bestInsertIndex(current.route,p);
  current.route.splice(idx,0,node);pendingInsert=null;$("#insertHint").hidden=true;recompute();toast(p.name+" aufgenommen");
}
function swapStop(id){ // Stopp entfernen und Betriebe-Liste ab dem Vorgänger öffnen
  if(!current)return;const i=current.route.findIndex(r=>r.p.id===id);if(i<1)return;
  pendingInsert={index:i,ref:current.route[i-1].p};current.route.splice(i,1);DONE.delete(id);recompute();
  showTab("tab-places");$("#insertHint").hidden=false;$("#insertHint").innerHTML="Ersatz wählen: „Hier einfügen“ setzt den Betrieb an die Stelle des entfernten Stopps (nach "+esc(pendingInsert.ref.name)+"). <button class='btn small ghost' type='button' id='cancelInsert'>Abbrechen</button>";
  $("#cancelInsert").addEventListener("click",()=>{pendingInsert=null;$("#insertHint").hidden=true;renderPlaces();});
}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-act]");if(!b)return;const id=b.dataset.id;const p=byId(id);const act=b.dataset.act;
  if(act==="asstart"){$("#start").value=id;if(map)map.closePopup();showTab("tab-plan");toast("Startpunkt gesetzt");}
  else if(act==="remove"){removeStop(id);if(map)map.closePopup();}
  else if(act==="add"){if(p)addStop(p,"best");if(map)map.closePopup();}
  else if(act==="next"){if(p)addStop(p,"next");if(map)map.closePopup();}
  else if(act==="insert"){if(p&&pendingInsert)addStop(p,pendingInsert);showTab("tab-route");}
  else if(act==="swap"){swapStop(id);}
});

// Unterwegs: ab jetzt (und von hier) neu planen
async function replanFromNow(){
  if(!current)return;const o={...current.opts};
  const now=new Date();o.startTime=now.getHours()+now.getMinutes()/60;o.date=now;o.dow=now.getDay();
  const doneStops=current.route.filter(r=>r.role==="stop"&&DONE.has(r.p.id));
  o.exclude=[...DONE];o.nStops=Math.max(0,current.route.filter(r=>r.role==="stop").length-doneStops.length);
  o.nSights=Math.max(0,current.route.filter(r=>r.role==="sight"&&!DONE.has(r.p.id)).length);
  let from=null;
  try{const c=await getPosition();mePos={lat:c.latitude,lon:c.longitude};from={id:"gps-now",name:"Aktueller Standort",kind:"start",tags:[],lat:c.latitude,lon:c.longitude,addr:"GPS"};updateMe();}catch(e){}
  if(!from){const last=doneStops[doneStops.length-1];from=last?{...last.p,id:"from-"+last.p.id,kind:"start"}:current.opts.start;}
  o.start=from;if(o.returnMode!=="end")o.end=current.opts.end;
  if(o.lastTime<=o.startTime){toast("Zeitfenster ist vorbei – letzte Einkehr später setzen");return;}
  if(o.nStops===0){toast("Alle Einkehren erledigt – gute Heimfahrt!");return;}
  await runPlan(o);toast("Route ab jetzt neu geplant");
}

// ---------- Supabase: Anmeldung & Kurzlinks ----------
let sb=null;let USER=null;
try{if(window.supabase&&C.SUPABASE_URL&&C.SUPABASE_KEY)sb=window.supabase.createClient(C.SUPABASE_URL,C.SUPABASE_KEY);}catch(e){sb=null;}
function renderUser(){const b=$("#userBtn");if(!b)return;if(USER){b.textContent=USER.email.split("@")[0];b.classList.add("on");b.setAttribute("aria-label","Konto");}else{b.textContent="Anmelden";b.classList.remove("on");}
  $("#authOut").hidden=!USER;$("#authIn").hidden=!!USER;if(USER)$("#authEmail").textContent=USER.email;}
if(sb){
  sb.auth.getSession().then(({data})=>{USER=data.session?data.session.user:null;renderUser();});
  sb.auth.onAuthStateChange((_e,session)=>{USER=session?session.user:null;renderUser();});
}
if(!sb||!C.AUTH_ENABLED){const b=$("#userBtn");if(b)b.hidden=true;}
$("#userBtn").addEventListener("click",()=>{renderUser();$("#authModal").hidden=false;$("#authStatus").textContent="";});
$("#authClose").addEventListener("click",()=>$("#authModal").hidden=true);
$("#authModal").addEventListener("click",e=>{if(e.target===$("#authModal"))$("#authModal").hidden=true;});
$("#sendCode").addEventListener("click",async()=>{
  const email=$("#authMail").value.trim();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){$("#authStatus").textContent="Bitte eine gültige E-Mail-Adresse eingeben.";return;}
  $("#authStatus").textContent="Code wird gesendet…";
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
  if(error){$("#authStatus").textContent="Senden fehlgeschlagen: "+error.message;return;}
  $("#codeWrap").hidden=false;$("#authStatus").textContent="E-Mail ist unterwegs. Code eingeben – oder den Link in der E-Mail antippen.";$("#authCode").focus();
});
$("#verifyCode").addEventListener("click",async()=>{
  const email=$("#authMail").value.trim();const token=$("#authCode").value.replace(/\s/g,"");
  if(token.length<6){$("#authStatus").textContent="Bitte den 6‑stelligen Code eingeben.";return;}
  $("#authStatus").textContent="Prüfe…";
  const {error}=await sb.auth.verifyOtp({email,token,type:"email"});
  if(error){$("#authStatus").textContent="Code ungültig oder abgelaufen.";return;}
  $("#authStatus").textContent="";toast("Angemeldet");setTimeout(()=>$("#authModal").hidden=true,400);
});
$("#logoutBtn").addEventListener("click",async()=>{await sb.auth.signOut();toast("Abgemeldet");$("#authModal").hidden=true;});
async function shortLink(hash){ // hash ohne "#"
  if(!sb)return null;
  const alphabet="abcdefghijklmnopqrstuvwxyz0123456789";
  for(let attempt=0;attempt<3;attempt++){
    let id="";const rnd=new Uint8Array(8);crypto.getRandomValues(rnd);for(const b of rnd)id+=alphabet[b%36];
    const {error}=await sb.from("shared_routes").insert({id,hash,owner:USER?USER.id:null});
    if(!error)return location.origin+location.pathname+"#t="+id;
    if(!/duplicate/i.test(error.message))return null;
  }
  return null;
}
async function resolveShort(id){if(!sb)return null;const {data}=await sb.from("shared_routes").select("hash").eq("id",id).maybeSingle();return data?data.hash:null;}

// ---------- Teilen / Speichern ----------
function routeHash(cur){const ids=cur.route.map(r=>r.p.id);const o=cur.opts;return "#r="+ids.join(",")+"&d="+isoDate(o.date)+"&t="+hhmm(o.startTime)+"-"+hhmm(o.lastTime)+"&m="+o.returnMode+"&s="+o.stay+"&p="+o.pace;}
function updateHash(){if(!current)return;try{history.replaceState(null,"",location.pathname+location.search+routeHash(current));}catch(e){}}
async function resolveHashIfShort(){
  const h=location.hash.slice(1);if(!h.startsWith("t="))return false;
  const hash=await resolveShort(h.slice(2).replace(/[^a-z0-9]/g,""));
  if(!hash){toast("Dieser Link ist nicht (mehr) gültig");return false;}
  try{history.replaceState(null,"",location.pathname+location.search+"#"+hash);}catch(e){}
  return true;
}
function loadFromHash(){
  const h=location.hash.slice(1);if(!h.startsWith("r="))return false;
  const q=Object.fromEntries(h.split("&").map(kv=>{const i=kv.indexOf("=");return [kv.slice(0,i),decodeURIComponent(kv.slice(i+1))];}));
  const ids=(q.r||"").split(",");const ps=ids.map(byId);if(ps.length<2||ps.some(p=>!p))return false;
  const [t1,t2]=(q.t||"10:00-18:00").split("-");const date=new Date((q.d||isoDate(new Date()))+"T12:00:00");
  const returnMode=q.m||"taxi";const start=ps[0];const end=returnMode==="taxi"?start:ps[ps.length-1];
  const opts={start,end,returnMode,nStops:ps.filter(p=>p.kind!=="sight"&&p!==start&&p!==end).length,nSights:ps.filter(p=>p.kind==="sight").length,stay:+(q.s||60),pace:+(q.p||3.8),interests:[],dow:date.getDay(),startTime:parseT(t1),lastTime:parseT(t2),date,exclude:[]};
  const route=ps.map((p,i)=>({p,role:i===0?"start":(returnMode!=="taxi"&&i===ps.length-1)?"end":(p.kind==="sight"?"sight":"stop")}));
  writeOpts(opts);finishPlan(route,opts,["Route aus geteiltem Link geladen."],false);showTab("tab-route");return true;
}
async function openShare(cur){
  const panel=$("#sharePanel");panel.hidden=false;$("#shareUrl").value="Link wird erstellt…";window.scrollTo({top:0,behavior:"smooth"});
  const longUrl=location.origin+location.pathname+routeHash(cur);
  let url=null;try{url=await shortLink(routeHash(cur).slice(1));}catch(e){url=null;}
  if(!url){url=longUrl;$("#shareNote").textContent="Kurzlink nicht verfügbar – der lange Link funktioniert genauso.";}
  else $("#shareNote").textContent="Wer den Link öffnet, sieht genau diese Route mit Zeitplan und kann sie selbst anpassen.";
  $("#shareUrl").value=url;
  const text="Weinweg Südsteiermark – "+cur.opts.start.name+", "+DOWN[cur.opts.dow]+" "+cur.opts.date.toLocaleDateString("de-AT")+": "+url;
  $("#shareWa").href="https://wa.me/?text="+encodeURIComponent(text);
  $("#shareMail").href="mailto:?subject="+encodeURIComponent("Weinweg Südsteiermark – Routenvorschlag")+"&body="+encodeURIComponent(routeText(cur).replace(/\n[^\n]*$/,"")+"\n\n"+url);
  const sys=$("#shareSys");sys.hidden=!navigator.share;sys.onclick=async()=>{try{await navigator.share({title:"Weinweg Südsteiermark",text,url});}catch(e){}};
  $("#shareCopy").onclick=()=>copy(url);
}
$("#shareClose").addEventListener("click",()=>$("#sharePanel").hidden=true);
function saveRoute(){if(!current)return;const o=current.opts;const name=o.start.name+" · "+DOWN[o.dow]+" "+o.date.toLocaleDateString("de-AT")+" · "+current.route.filter(r=>r.role==="stop").length+" Einkehren";SAVED.unshift({name,hash:routeHash(current),ts:Date.now()});SAVED=SAVED.slice(0,12);store.set("ww.saved",SAVED);renderSaved();toast("Route gespeichert");}
function renderSaved(){
  const card=$("#savedCard");card.hidden=!SAVED.length;
  $("#savedList").innerHTML=SAVED.map((s,i)=>'<div class="saved"><div><b>'+esc(s.name)+'</b><small>'+new Date(s.ts).toLocaleString("de-AT",{dateStyle:"short",timeStyle:"short"})+'</small></div><button class="btn small" type="button" data-load="'+i+'">Laden</button><button class="btn small ghost" type="button" data-del="'+i+'">×</button></div>').join("");
  $("#savedList").querySelectorAll("[data-load]").forEach(b=>b.addEventListener("click",()=>{location.hash=SAVED[+b.dataset.load].hash;if(!loadFromHash())toast("Route konnte nicht geladen werden (Betrieb fehlt)");}));
  $("#savedList").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{SAVED.splice(+b.dataset.del,1);store.set("ww.saved",SAVED);renderSaved();}));
}

// ---------- Darstellung Plan ----------
function mapsLink(items){const pts=items.map(i=>i.p.lat.toFixed(5)+","+i.p.lon.toFixed(5));const o=pts[0],d=pts[pts.length-1];const wp=pts.slice(1,-1).slice(0,9).join("|");return "https://www.google.com/maps/dir/?api=1&origin="+o+"&destination="+d+"&travelmode=walking"+(wp?"&waypoints="+encodeURIComponent(wp):"");}
function routeText(cur){const {res,opts}=cur;const lines=[opts.start.name+" · "+DOWN[opts.dow]+", "+opts.date.toLocaleDateString("de-AT")];for(const it of res.items){lines.push(hhmm(it.arrive)+"  "+it.p.name+(it.stay?" (bis "+hhmm(it.depart)+")":""));}if(opts.returnMode==="taxi"&&res.lastStop)lines.push("Rückfahrt mit WEINmobil ab "+res.lastStop.p.name+" nach "+opts.start.name+", Tel. "+WEINMOBIL.phone);lines.push("Gesamt "+fmtKm(res.km)+", Gehzeit "+fmtMin(res.walkMin)+(res.ascent?", "+Math.round(res.ascent)+" Hm":""));lines.push(location.origin+location.pathname+routeHash(cur));return lines.join("\n");}

function elevationProfile(cur){
  const g=cur.geometry;if(!g||g.length<3||g[0][2]==null)return "";
  let d=0;const pts=[];for(let i=0;i<g.length;i++){if(i)d+=P.dist({lat:g[i-1][0],lon:g[i-1][1]},{lat:g[i][0],lon:g[i][1]});pts.push([d,g[i][2]]);}
  const W=600,H=110,L=34,B=18,T=8;const maxD=d||1;const es=pts.map(p=>p[1]);const minE=Math.floor(Math.min(...es)/10)*10,maxE=Math.ceil(Math.max(...es)/10)*10||minE+10;
  const X=x=>L+x/maxD*(W-L-6),Y=e=>T+(1-(e-minE)/(maxE-minE))*(H-T-B);
  const line=pts.map((p,i)=>(i?"L":"M")+X(p[0]).toFixed(1)+" "+Y(p[1]).toFixed(1)).join(" ");
  const area=line+" L"+X(maxD).toFixed(1)+" "+(H-B)+" L"+L+" "+(H-B)+" Z";
  // Stopps markieren
  let cum=0;const marks=[];cur.res.items.forEach((it,i)=>{if(i){cum+=it.leg.km;}if(it.role==="stop"){marks.push('<line x1="'+X(cum).toFixed(1)+'" x2="'+X(cum).toFixed(1)+'" y1="'+T+'" y2="'+(H-B)+'" stroke="var(--wine)" stroke-dasharray="2 3" stroke-width="1"/>');}});
  return '<svg class="profile" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Höhenprofil"><path d="'+area+'" fill="var(--vine-soft)"/><path d="'+line+'" fill="none" stroke="var(--vine)" stroke-width="2"/>'+marks.join("")+'<text x="2" y="'+(T+10)+'">'+maxE+' m</text><text x="2" y="'+(H-B-2)+'">'+minE+' m</text><text x="'+L+'" y="'+(H-4)+'">0 km</text><text x="'+(W-6)+'" y="'+(H-4)+'" text-anchor="end">'+fmtKm(maxD)+'</text></svg>';
}

function renderRoute(cur){
  const out=$("#routeOut");
  if(!cur){out.innerHTML='<div class="card empty"><b>Keine Route gefunden</b>Weniger Einkehren wählen oder das Zeitfenster vergrößern.</div>';return;}
  const {res,opts:o}=cur;let n=0;const rows=[];
  const sunset=WX&&WX.sunset;
  res.items.forEach((it,i)=>{
    if(i>0){const l=it.leg;rows.push('<div class="leg"><span></span><span class="bar"></span><span>zu Fuß '+fmtKm(l.km)+' · ca. '+fmtMin(l.min)+(l.ascent?' · ↑'+Math.round(l.ascent)+' m':'')+(l.estimated?' (geschätzt)':'')+'</span></div>');}
    const isStop=it.role==="stop";if(isStop)n++;
    const cls=it.role==="sight"?"sight":(isStop?"":"edge");const done=DONE.has(it.p.id);
    const label=it.role==="start"?"S":it.role==="end"?"Z":it.role==="sight"?"◆":String(n);
    let flag="";
    if(it.open){if(it.open.s==="open")flag='<span class="flag ok">geöffnet bis '+hhmm(it.open.close)+'</span>';else if(it.open.s==="later")flag='<span class="flag">öffnet erst um '+hhmm(it.open.opens)+'</span>';else if(it.open.s==="closed")flag='<span class="flag">heute geschlossen</span>';else flag='<span class="flag" style="color:var(--muted)">'+(it.p.oh?'OSM: '+esc(it.p.oh):'Öffnungszeiten prüfen')+'</span>';}
    if(it.p.note&&/Voranmeldung|anrufen/i.test(it.p.note))flag+=' <span class="flag">Voranmeldung</span>';
    const w=wxAt(it.arrive);const wxs=w?'<span class="wxs">'+WXICON(w.c)+' '+Math.round(w.t)+' °C'+(w.p>=20?' · '+w.p+' % Regen':'')+'</span>':'';
    const sun=sunset&&it.arrive>sunset&&isStop?' <span class="flag">nach Sonnenuntergang ('+hhmm(sunset)+')</span>':'';
    const editable=(isStop||it.role==="sight");
    const tools=editable?'<div class="tools" hidden><label class="mark"><input type="checkbox" data-done="'+esc(it.p.id)+'"'+(done?' checked':'')+'> erledigt</label><button class="btn small ghost" type="button" data-act="swap" data-id="'+esc(it.p.id)+'">Tauschen</button><button class="btn small danger" type="button" data-act="remove" data-id="'+esc(it.p.id)+'">Entfernen</button></div>':'';
    const more=editable?'<button class="more" type="button" aria-label="Optionen" data-more="1">⋯</button>':'';
    const links=linkHtml(it.p);
    rows.push('<div class="stop '+cls+(done?' done':'')+'"><div class="t">'+hhmm(it.arrive)+(it.stay?'<small>bis '+hhmm(it.depart)+'</small>':'')+'</div><div class="dot">'+label+'</div><div class="body"><div class="head"><b>'+esc(it.p.name)+'</b>'+more+'</div>'+wxs+'<p>'+esc(it.p.addr||"")+(it.p.note?' · '+esc(it.p.note):'')+'</p>'+(links?'<p class="links">'+links+'</p>':'')+flag+sun+tools+'</div></div>');
  });
  let taxi="";
  if(o.returnMode==="taxi"&&res.lastStop){
    const pickup=res.lastStop.depart;const book=pickup-1.5;
    rows.push('<div class="leg"><span></span><span class="bar taxi"></span><span>WEINmobil zurück nach '+esc(o.start.name)+'</span></div>');
    rows.push('<div class="stop edge"><div class="t">'+hhmm(pickup)+'</div><div class="dot">🚕</div><div class="body"><b>Abholung bei '+esc(res.lastStop.p.name)+'</b><p>Rückfahrt zum Ausgangspunkt; Fahrt bis spätestens '+hhmm(book)+' buchen.</p></div></div>');
    taxi='<div class="card taxi stack"><div><span class="eyebrow">Rückfahrt</span><h3>'+WEINMOBIL.name+'</h3><p class="notice">'+WEINMOBIL.hint+'</p></div><div class="row"><span class="phone">'+WEINMOBIL.phone+'</span><button class="btn small ghost" type="button" id="copyPhone">Kopieren</button></div><div class="row"><a class="btn small" href="tel:'+WEINMOBIL.phoneRaw+'">Anrufen</a><a class="btn small ghost" href="'+WEINMOBIL.booking+'" target="_blank" rel="noopener">Online buchen</a><a class="btn small ghost" href="'+WEINMOBIL.web+'" target="_blank" rel="noopener">weinmobil.at</a></div><p class="notice">Abholpunkt: '+esc(res.lastStop.p.name)+', '+esc(res.lastStop.p.addr||"")+' → Ziel: '+esc(o.start.name)+'. Buchung bis '+hhmm(book)+' Uhr.</p></div>';
  }
  const stops=res.items.filter(i=>i.role==="stop").length;
  // Wetter-Zusammenfassung
  let wx="";
  if(WX&&WX.hourly){const hs=[];for(let h=Math.floor(o.startTime);h<=Math.min(23,Math.ceil(res.endT));h++)hs.push(wxAt(h));const ts=hs.map(x=>x.t),ps=hs.map(x=>x.p);
    wx='<div class="wx"><span>'+WXICON(hs[Math.floor(hs.length/2)].c)+' <b>'+Math.round(Math.min(...ts))+'–'+Math.round(Math.max(...ts))+' °C</b></span><span>Regen bis <b>'+Math.max(...ps)+' %</b></span>'+(WX.sunset?'<span>Sonnenuntergang <b>'+hhmm(WX.sunset)+'</b></span>':'')+'</div>';}
  const warn=cur.warnings.length?'<div class="card" style="border-color:var(--sun)"><span class="eyebrow">Hinweise</span><ul style="margin:6px 0 0;padding-left:18px">'+[...new Set(cur.warnings)].map(w=>'<li>'+esc(w)+'</li>').join("")+'</ul></div>':"";
  out.innerHTML=
    '<div class="card"><span class="eyebrow">'+DOWN[o.dow]+', '+o.date.toLocaleDateString("de-AT")+(res.estimated?' · Gehzeiten geschätzt':' · Wege: openrouteservice')+'</span><h2>Ab '+esc(o.start.name)+'</h2>'+
    '<div class="summary"><div><b>'+fmtKm(res.km)+'</b><span>zu Fuß'+(res.ascent?' · ↑'+Math.round(res.ascent)+' m':'')+'</span></div><div><b>'+fmtMin(res.walkMin)+'</b><span>Gehzeit</span></div><div><b>'+stops+'</b><span>Einkehren · je '+res.stayUsed+' min</span></div></div>'+wx+elevationProfile(cur)+
    '<div class="row" style="margin-top:12px"><button class="btn small" type="button" id="toMap">Karte</button><button class="btn small ghost" type="button" id="shareBtn">Teilen</button><button class="btn small ghost" type="button" id="moreBtn">Mehr …</button></div>'+
    '<div class="row" id="moreRow" hidden style="margin-top:8px"><button class="btn small ghost" type="button" id="shuffleBtn">Andere Vorschläge</button><button class="btn small ghost" type="button" id="saveBtn">Speichern</button><a class="btn small ghost" href="'+mapsLink(res.items)+'" target="_blank" rel="noopener">Google Maps</a><button class="btn small ghost" type="button" id="copyRoute">Plan kopieren</button><button class="btn small ghost" type="button" id="replan">Eingaben ändern</button></div></div>'+
    warn+
    '<div class="card"><span class="eyebrow">Tagesplan</span><p class="notice" style="margin:4px 0 0">⋯ bei einem Stopp öffnet Tauschen, Entfernen und Erledigt.</p><div class="timeline">'+rows.join("")+'</div></div>'+
    taxi+
    '<div class="card stack" style="border-left:4px solid var(--wine)"><div><span class="eyebrow">Unterwegs</span><p class="notice">Erledigte Stopps abhaken, dann ab GPS-Standort und aktueller Uhrzeit neu planen – die Weintaxi-Zeit wandert mit.</p></div><button class="btn wide" type="button" id="replanNow">Ab jetzt neu planen</button></div>';
  const cp=$("#copyPhone");if(cp)cp.addEventListener("click",()=>copy(WEINMOBIL.phone));
  $("#copyRoute").addEventListener("click",()=>copy(routeText(cur)));
  $("#replan").addEventListener("click",()=>showTab("tab-plan"));
  $("#toMap").addEventListener("click",()=>showTab("tab-map"));
  $("#moreBtn").addEventListener("click",()=>{const r=$("#moreRow");r.hidden=!r.hidden;});
  out.querySelectorAll("[data-more]").forEach(b=>b.addEventListener("click",()=>{const t=b.closest(".body").querySelector(".tools");t.hidden=!t.hidden;}));
  $("#replanNow").addEventListener("click",replanFromNow);
  $("#saveBtn").addEventListener("click",saveRoute);
  $("#shuffleBtn").addEventListener("click",()=>{const o={...cur.opts,jitter:1.6,exclude:[]};DONE=new Set();runPlan(o);});
  $("#shareBtn").addEventListener("click",()=>openShare(cur));
  out.querySelectorAll("[data-done]").forEach(cb=>cb.addEventListener("change",()=>{if(cb.checked)DONE.add(cb.dataset.done);else DONE.delete(cb.dataset.done);cb.closest(".stop").classList.toggle("done",cb.checked);}));
}

// ---------- Karte ----------
let map=null,layerAll=null,layerRoute=null,meMarker=null;
function initMap(){
  if(typeof L==="undefined"){$("#mapStatus").textContent="Karte konnte nicht geladen werden.";return;}
  map=L.map("map",{zoomControl:true,tap:false});
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'}).addTo(map);
  const [s,w,n,e]=C.BBOX;map.fitBounds([[s,w],[n,e]]);
  layerAll=L.layerGroup().addTo(map);layerRoute=L.layerGroup().addTo(map);
  drawAllPlaces();
}
const pin=(cls,label,size)=>L.divIcon({className:"",html:'<div class="ww-pin '+cls+'">'+(label||"")+'</div>',iconSize:[size||26,size||26],iconAnchor:[(size||26)/2,(size||26)/2],popupAnchor:[0,-(size||26)/2]});
function popupHtml(p,it){
  const hours=p.oh?'<div>Öffnungszeiten (OSM): '+esc(p.oh)+'</div>':(p.note?'<div>'+esc(p.note)+'</div>':'');
  const time=it?'<div><b style="font-family:var(--body);font-size:.95rem">'+hhmm(it.arrive)+(it.stay?' – '+hhmm(it.depart):'')+'</b></div>':'';
  let tools='';
  if(it&&(it.role==="stop"||it.role==="sight"))tools='<button class="btn small danger" type="button" data-act="remove" data-id="'+esc(p.id)+'">Aus Route entfernen</button><button class="btn small ghost" type="button" data-act="swap" data-id="'+esc(p.id)+'">Tauschen</button>';
  else if(p.kind!=="start"&&!inRoute(p.id))tools='<button class="btn small" type="button" data-act="add" data-id="'+esc(p.id)+'">In Route aufnehmen</button><button class="btn small ghost" type="button" data-act="next" data-id="'+esc(p.id)+'">Als nächsten Stopp</button>';
  if(p.kind!=="sight")tools+='<button class="btn small ghost" type="button" data-act="asstart" data-id="'+esc(p.id)+'">Als Start</button>';
  const ref=current?current.opts.start:byId($("#start").value);const dist=ref?'<div class="notice">'+fmtKm(P.dist(ref,p))+' Luftlinie ab '+esc(ref.name)+'</div>':'';
  const links=linkHtml(p);
  return time+'<b>'+esc(p.name)+'</b><div>'+esc(p.addr||"")+'</div>'+hours+(links?'<div>'+links+'</div>':'')+dist+'<div class="pop-tools">'+tools+'</div>';
}
function drawAllPlaces(){
  if(!map)return;layerAll.clearLayers();
  for(const p of allPlaces()){
    if(p.temp||inRoute(p.id))continue;
    const cls=(p.kind==="sight"?"sight":p.kind==="start"?"edge":"")+" faint";
    L.marker([p.lat,p.lon],{icon:pin(cls,"",16)}).bindPopup(()=>popupHtml(p)).addTo(layerAll);
  }
}
function drawRoute(cur){
  if(!map)return;layerRoute.clearLayers();drawAllPlaces();if(!cur)return;
  const pts=cur.route.map(r=>[r.p.lat,r.p.lon]);
  if(cur.geometry)L.polyline(cur.geometry.map(c=>[c[0],c[1]]),{color:"#398140",weight:5,opacity:.9}).addTo(layerRoute);
  else L.polyline(pts,{color:"#398140",weight:4,dashArray:"8 6",opacity:.8}).addTo(layerRoute);
  if(cur.opts.returnMode==="taxi"&&cur.res.lastStop)L.polyline([[cur.res.lastStop.p.lat,cur.res.lastStop.p.lon],[cur.opts.start.lat,cur.opts.start.lon]],{color:"#d9a441",weight:3,dashArray:"2 8"}).addTo(layerRoute);
  let n=0;
  cur.res.items.forEach(it=>{const isStop=it.role==="stop";if(isStop)n++;const cls=it.role==="sight"?"sight":isStop?"":"edge";const label=it.role==="start"?"S":it.role==="end"?"Z":isStop?String(n):"";
    L.marker([it.p.lat,it.p.lon],{icon:pin(cls,label,it.role==="sight"?18:26),zIndexOffset:500}).bindPopup(()=>popupHtml(it.p,it)).addTo(layerRoute);});
  if(!$("#panel-map").hidden)fitRoute();
}
function fitRoute(){if(!map||!current)return;const pts=current.geometry?current.geometry.map(c=>[c[0],c[1]]):current.route.map(r=>[r.p.lat,r.p.lon]);map.fitBounds(L.latLngBounds(pts).pad(0.12));}
function updateMe(){if(!map||!mePos)return;if(!meMarker){meMarker=L.marker([mePos.lat,mePos.lon],{icon:L.divIcon({className:"",html:'<div class="ww-me"></div>',iconSize:[18,18],iconAnchor:[9,9]}),zIndexOffset:1000}).addTo(map);}else meMarker.setLatLng([mePos.lat,mePos.lon]);}
$("#locBtn").addEventListener("click",async()=>{try{$("#mapStatus").textContent="Standort wird ermittelt…";const c=await getPosition();mePos={lat:c.latitude,lon:c.longitude};updateMe();map.setView([mePos.lat,mePos.lon],15);$("#mapStatus").textContent="";}catch(e){$("#mapStatus").textContent=e.message;}});
$("#fitBtn").addEventListener("click",()=>{if(current)fitRoute();else toast("Noch keine Route geplant");});

// ---------- Betriebe (nach Entfernung gegliedert) ----------
let placeKind="all";
const norm2=s=>String(s||"").toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
$("#placeQ").addEventListener("input",()=>{$("#placeQClear").hidden=!$("#placeQ").value;renderPlaces();});
$("#placeQClear").addEventListener("click",()=>{$("#placeQ").value="";$("#placeQClear").hidden=true;renderPlaces();$("#placeQ").focus();});
function refPoint(){
  if(pendingInsert)return {p:pendingInsert.ref,label:"ab "+pendingInsert.ref.name+" (Ersatz einfügen)"};
  if(current){const stops=current.route.filter(r=>r.role==="stop"||r.role==="sight");const last=stops[stops.length-1];if(last)return {p:last.p,label:"ab letztem Stopp "+last.p.name+" – „Nächster Stopp“ hängt dort an"};return {p:current.opts.start,label:"ab Startpunkt "+current.opts.start.name};}
  const s=byId($("#start").value);return s?{p:s,label:"ab Startpunkt "+s.name}:{p:null,label:""};
}
function renderPlaces(){
  const ref=refPoint();$("#placesRef").textContent=ref.p?"Sortiert nach Luftlinie "+ref.label+".":"";
  const kindName={buschenschank:"Buschenschank",gasthaus:"Gasthaus",sight:"Wegpunkt"};
  const qn=norm2($("#placeQ")?$("#placeQ").value:"");
  let ps=allPlaces().filter(p=>p.kind!=="start"&&(placeKind==="all"||p.kind===placeKind));
  if(qn)ps=ps.filter(p=>norm2([p.name,p.addr,p.note,(p.tags||[]).join(" ")].join(" ")).includes(qn));
  ps=ps.map(p=>({p,d:ref.p?P.dist(ref.p,p):0})).sort((a,b)=>a.d-b.d||a.p.name.localeCompare(b.p.name,"de"));
  const groups=[["bis 1,5 km",0,1.5],["1,5 – 3 km",1.5,3],["3 – 5 km",3,5],["über 5 km",5,1e9]];
  const now=new Date();const dow=current?current.opts.dow:now.getDay();
  const item=({p,d})=>{
    const ir=inRoute(p.id);const st=(p.kind!=="sight")?P.openStatus(p,dow,current?current.opts.startTime+2:14):null;
    const stTxt=!st?'':st.s==="closed"?'<span class="flag">Ruhetag</span>':st.s==="unknown"?(p.oh?'<span class="flag" style="color:var(--muted)">OSM: '+esc(p.oh)+'</span>':''):'';
    let btns='';
    if(ir)btns='<button class="btn small danger" type="button" data-act="remove" data-id="'+esc(p.id)+'">Entfernen</button>';
    else if(pendingInsert)btns='<button class="btn small" type="button" data-act="insert" data-id="'+esc(p.id)+'">Hier einfügen</button>';
    else btns='<button class="btn small" type="button" data-act="next" data-id="'+esc(p.id)+'">Nächster Stopp</button>';
    btns+='<button class="btn small ghost" type="button" data-edit="'+esc(p.id)+'">⋯</button>';
    const links=linkHtml(p);
    return '<div class="place'+(ir?' inroute':'')+'" data-id="'+esc(p.id)+'"><div><span class="dist">'+fmtKm(d)+'</span> <b>'+esc(p.name)+'</b>'+(ir?' <span class="tag w">in Route</span>':'')+'<p>'+esc(p.addr||"")+'</p>'+(links?'<p class="links">'+links+'</p>':'')+(p.note?'<p>'+esc(p.note)+'</p>':'')+'<div><span class="tag w">'+kindName[p.kind]+'</span>'+(p.verified?'<span class="tag">OSM-verortet</span>':p.source==="osm"?'<span class="tag">aus OSM</span>':'')+(p.tags||[]).map(t=>'<span class="tag">'+esc(t)+'</span>').join("")+' '+stTxt+'</div></div><div class="pt">'+btns+'</div></div>';
  };
  let html="";
  for(const [label,a,b] of groups){const g=ps.filter(x=>x.d>=a&&x.d<b);if(!g.length)continue;html+='<div class="card group"><h3>'+label+'<small>'+g.length+' Einträge</small></h3>'+g.map(item).join("")+'</div>';}
  $("#placeList").innerHTML=html||'<div class="card empty"><b>'+(qn?'Nichts gefunden':'Keine Einträge')+'</b>'+(qn?'Anders schreiben oder die Suche löschen.':'')+'</div>';
}
renderPlaces();
$("#placeFilter").addEventListener("click",e=>{const b=e.target.closest("[data-k]");if(!b)return;placeKind=b.dataset.k;$("#placeFilter").querySelectorAll(".chip").forEach(c=>c.dataset.on=c===b?"1":"0");renderPlaces();});
$("#placeList").addEventListener("click",e=>{
  const b=e.target.closest("[data-edit]");if(!b)return;const id=b.dataset.edit;const p=byId(id);const row=b.closest(".place");
  if(row.querySelector(".editor"))return;
  const ed=document.createElement("div");ed.className="editor stack";ed.style.gridColumn="1 / -1";
  ed.innerHTML=(!inRoute(id)&&!pendingInsert&&current?'<div class="row"><button class="btn small ghost" type="button" data-act="add" data-id="'+esc(id)+'">An passender Stelle einfügen</button></div>':'')+'<div class="grid2"><label class="f">Breite (lat)<input value="'+p.lat+'" inputmode="decimal"></label><label class="f">Länge (lon)<input value="'+p.lon+'" inputmode="decimal"></label></div><div class="row"><button class="btn small" type="button">Lage übernehmen</button><button class="btn small ghost" type="button">Schließen</button>'+(p.source==="osm"?'<button class="btn small ghost" type="button" data-hide="1">Ausblenden</button>':'')+'</div>';
  row.appendChild(ed);const [la,lo]=ed.querySelectorAll("input");const bs=[...ed.querySelectorAll("button")].filter(b=>!b.dataset.act);const [ok,cancel,hide]=bs;
  cancel.addEventListener("click",()=>ed.remove());
  if(hide)hide.addEventListener("click",()=>{OVERRIDES[id]={...(OVERRIDES[id]||{}),hidden:true};store.set("ww.over",OVERRIDES);renderPlaces();fillSelects();drawAllPlaces();toast("Ausgeblendet");});
  ok.addEventListener("click",()=>{const lat=parseFloat(la.value.replace(",",".")),lon=parseFloat(lo.value.replace(",","."));if(!(lat>45&&lat<48&&lon>14&&lon<17)){toast("Koordinaten außerhalb der Steiermark");return;}
    const ci=CUSTOM.findIndex(c=>c.id===id);if(ci>=0){CUSTOM[ci].lat=lat;CUSTOM[ci].lon=lon;store.set("ww.custom",CUSTOM);}else{OVERRIDES[id]={...(OVERRIDES[id]||{}),lat,lon};store.set("ww.over",OVERRIDES);}renderPlaces();fillSelects();drawAllPlaces();toast("Lage gespeichert");});
});
$("#pGeocode").addEventListener("click",async()=>{const q=($("#pName").value+" "+$("#pAddr").value).trim();if(!q){toast("Name oder Adresse eingeben");return;}$("#pGeoStatus").textContent="Suche…";try{const h=(await geocode($("#pAddr").value.trim()||q))[0];if(!h){$("#pGeoStatus").textContent="Nicht gefunden";return;}$("#pLat").value=(+h.lat).toFixed(5);$("#pLon").value=(+h.lon).toFixed(5);$("#pGeoStatus").textContent=h.display_name.split(",").slice(0,3).join(", ");}catch(e){$("#pGeoStatus").textContent="Suche nicht erreichbar";}});
$("#pAdd").addEventListener("click",()=>{
  const name=$("#pName").value.trim();const lat=parseFloat($("#pLat").value.replace(",",".")),lon=parseFloat($("#pLon").value.replace(",","."));
  if(!name){toast("Bitte einen Namen eingeben");return;}
  if(!(lat>45&&lat<48&&lon>14&&lon<17)){toast("Bitte gültige Koordinaten eingeben (oder Adresse suchen)");return;}
  const tags=$("#pTags").value.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
  CUSTOM.push({id:"c"+Date.now(),name,kind:$("#pKind").value,addr:$("#pAddr").value.trim(),lat,lon,tags,stay:15});
  store.set("ww.custom",CUSTOM);renderPlaces();fillSelects();drawAllPlaces();["#pName","#pAddr","#pLat","#pLon","#pTags"].forEach(s=>$(s).value="");$("#pGeoStatus").textContent="";toast("Gespeichert");
});

// ---------- Version ----------
(function(){const v=$("#versionInfo");if(v)v.textContent="Weinweg Südsteiermark · Version "+(C.APP_VERSION||"?")+" · Daten: OpenStreetMap, openrouteservice, open-meteo";
  const h=document.querySelector("header.top .sub");if(h)h.title="Version "+(C.APP_VERSION||"");})();

// ---------- Start ----------
initMap();renderSaved();
loadOSM(false).then(async()=>{ // Geteilter Link (kurz oder lang), sonst Testroute: Ehrenhausen Kirchenplatz, 10–18 Uhr, 5 Buschenschanken, Weintaxi
  await resolveHashIfShort();
  if(!loadFromHash()&&!current)runPlan(readOpts());
});
})();
