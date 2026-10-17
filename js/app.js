/* Weinweg Südsteiermark – App-Logik (Formular, OSM-Abgleich, Routing, Karte, GPS, Unterwegs-Modus) */
(function(){
const C=window.WW_CONFIG;const P=window.Planner;
const {hhmm,parseT,fmtKm,fmtMin}=P;
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DOWN=["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];

// ---------- lokale Daten ----------
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
let CUSTOM=store.get("ww.custom",[]);let OVERRIDES=store.get("ww.over",{});let OSM=store.get("ww.osm",null);
let STARTS=[];            // temporäre Startpunkte (Suche, GPS)
let DONE=new Set();       // erledigte Stopps (Unterwegs-Modus)
let current=null;         // aktuelles Ergebnis {res, opts, route, legs, geometry}
let mePos=null;

function allPlaces(){
  const osmExtra=(OSM&&OSM.extra)||[];const snap=(OSM&&OSM.snap)||{};
  const seed=SEED_PLACES.map(p=>{let q={...p};if(snap[p.id])q={...q,...snap[p.id],verified:true};if(OVERRIDES[p.id])q={...q,...OVERRIDES[p.id]};return q;});
  const extra=osmExtra.filter(e=>!OVERRIDES[e.id]||!OVERRIDES[e.id].hidden).map(e=>OVERRIDES[e.id]?{...e,...OVERRIDES[e.id]}:e);
  return [...seed,...extra,...CUSTOM,...STARTS];
}
const byId=id=>allPlaces().find(p=>p.id===id);

// ---------- UI-Helfer ----------
const toastEl=$("#toast");let toastT;
function toast(m){toastEl.textContent=m;toastEl.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>toastEl.classList.remove("show"),2200);}
async function copy(text){try{await navigator.clipboard.writeText(text);toast("Kopiert");}catch(e){toast("Kopieren nicht möglich");}}
const tabs=[...document.querySelectorAll('[role="tab"]')];
function showTab(id){for(const t of tabs){const on=t.id===id;t.setAttribute("aria-selected",on);document.getElementById(t.getAttribute("aria-controls")).hidden=!on;}window.scrollTo({top:0});if(id==="tab-map"&&map){setTimeout(()=>map.invalidateSize(),50);}}
tabs.forEach(t=>t.addEventListener("click",()=>showTab(t.id)));

// ---------- Formular ----------
function fillSelects(){
  const ps=allPlaces();
  const opts=ps.filter(p=>p.kind!=="sight").sort((a,b)=>(a.kind==="start"?0:1)-(b.kind==="start"?0:1)||a.name.localeCompare(b.name,"de"));
  for(const sel of [$("#start"),$("#end")]){const v=sel.value;sel.innerHTML="";for(const p of opts){const o=document.createElement("option");o.value=p.id;o.textContent=p.name;sel.appendChild(o);}sel.value=v;if(!sel.value)sel.value=sel.id==="start"?"ehrenhausen":"gamlitz";}
}
fillSelects();
(function(){const d=new Date();const z=n=>String(n).padStart(2,"0");$("#date").value=d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate());})();
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
  STARTS=STARTS.filter(s=>s.id!=="gps");STARTS.push(p);fillSelects();$("#start").value=id;return p;
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
$("#gpsStart").addEventListener("click",async()=>{try{const c=await getPosition();mePos={lat:c.latitude,lon:c.longitude};STARTS=STARTS.filter(s=>s.id!=="gps");STARTS.push({id:"gps",name:"Mein Standort",kind:"start",tags:[],lat:c.latitude,lon:c.longitude,addr:"GPS"});fillSelects();$("#start").value="gps";toast("Standort als Start gesetzt");updateMe();}catch(e){toast(e.message);}});

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

// ---------- Routing (openrouteservice) ----------
async function orsRoute(points){
  if(!C.ROUTE_URL)return null;
  const body={coordinates:points.map(p=>[+p.lon.toFixed(6),+p.lat.toFixed(6)])};
  const r=await fetch(C.ROUTE_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok){let msg="";try{msg=(await r.json()).error?.message||"";}catch(e){}throw new Error("Routing "+r.status+(msg?": "+msg:""));}
  const g=await r.json();const f=g.features&&g.features[0];if(!f)throw new Error("Routing: keine Route");
  return {geometry:f.geometry.coordinates.map(c=>[c[1],c[0]]),segments:f.properties.segments,summary:f.properties.summary};
}
function legsFromORS(ors,pace){
  return ors.segments.map(s=>{const km=s.distance;const asc=s.ascent||0;return {km,min:km/pace*60+asc/10,ascent:asc,descent:s.descent||0,estimated:false};});
}

// ---------- Planen ----------
async function runPlan(opts){
  const places=allPlaces();
  let {route,warnings:w0}=P.selectRoute(opts,places);
  if(route.length<2){renderRoute(null,opts);return;}
  // 1) Schnelle Vorschau mit Luftlinie
  let legs=P.airLegs(route,opts.pace);let res=P.schedule(route,legs,opts);
  while(res.dropped&&P.dropLastStop(route)){legs=P.airLegs(route,opts.pace);res=P.schedule(route,legs,opts);w0.push("Eine Einkehr wurde gestrichen, damit die letzte Einkehr bis "+hhmm(opts.lastTime)+" erreicht wird.");}
  current={res,opts,route,legs,geometry:null,warnings:[...w0,...res.warnings]};
  renderRoute(current);drawRoute(current);
  // 2) Echte Wege nachladen
  if(!C.ROUTE_URL){current.warnings.push("Kein Routing-Dienst hinterlegt – Gehzeiten aus Luftlinie geschätzt.");renderRoute(current);return;}
  $("#mapStatus").textContent="Wege werden berechnet…";
  try{
    for(let round=0;round<3;round++){
      const ors=await orsRoute(route.map(r=>r.p));
      legs=legsFromORS(ors,opts.pace);res=P.schedule(route,legs,opts);
      current={res,opts,route,legs,geometry:ors.geometry,warnings:[...w0,...res.warnings]};
      if(res.dropped&&P.dropLastStop(route)){w0.push("Eine Einkehr wurde gestrichen, damit die letzte Einkehr bis "+hhmm(opts.lastTime)+" erreicht wird.");continue;}
      break;
    }
    $("#mapStatus").textContent="";renderRoute(current);drawRoute(current);
  }catch(e){$("#mapStatus").textContent="";current.warnings.push("Routing nicht verfügbar ("+e.message+") – Gehzeiten geschätzt.");renderRoute(current);}
}
$("#planBtn").addEventListener("click",()=>{const o=readOpts();if(o.lastTime<=o.startTime){toast("Die letzte Einkehr muss nach dem Start liegen");return;}DONE=new Set();runPlan(o);showTab("tab-route");});

// Unterwegs: ab jetzt (und von hier) neu planen
async function replanFromNow(){
  if(!current)return;const o={...current.opts};
  const now=new Date();o.startTime=now.getHours()+now.getMinutes()/60;o.date=now;o.dow=now.getDay();
  const doneStops=current.route.filter(r=>r.role==="stop"&&DONE.has(r.p.id));
  o.exclude=[...DONE];o.nStops=Math.max(0,current.route.filter(r=>r.role==="stop").length-doneStops.length);
  o.nSights=Math.max(0,o.nSights-current.route.filter(r=>r.role==="sight"&&DONE.has(r.p.id)).length);
  let from=null;
  try{const c=await getPosition();mePos={lat:c.latitude,lon:c.longitude};from={id:"gps-now",name:"Aktueller Standort",kind:"start",tags:[],lat:c.latitude,lon:c.longitude,addr:"GPS"};updateMe();}catch(e){}
  if(!from){const last=doneStops[doneStops.length-1];from=last?{...last.p,id:"from-"+last.p.id,kind:"start"}:current.opts.start;}
  o.start=from;if(o.returnMode!=="end")o.end=current.opts.end;
  if(o.lastTime<=o.startTime){toast("Zeitfenster ist vorbei – letzte Einkehr später setzen");return;}
  if(o.nStops===0){toast("Alle Einkehren erledigt – gute Heimfahrt!");return;}
  await runPlan(o);toast("Route ab jetzt neu geplant");
}

// ---------- Darstellung Plan ----------
function mapsLink(items){const pts=items.map(i=>i.p.lat.toFixed(5)+","+i.p.lon.toFixed(5));const o=pts[0],d=pts[pts.length-1];const wp=pts.slice(1,-1).slice(0,9).join("|");return "https://www.google.com/maps/dir/?api=1&origin="+o+"&destination="+d+"&travelmode=walking"+(wp?"&waypoints="+encodeURIComponent(wp):"");}
function routeText(cur){const {res,opts}=cur;const lines=[opts.start.name+" · "+DOWN[opts.dow]+", "+opts.date.toLocaleDateString("de-AT")];for(const it of res.items){lines.push(hhmm(it.arrive)+"  "+it.p.name+(it.stay?" (bis "+hhmm(it.depart)+")":""));}if(opts.returnMode==="taxi"&&res.lastStop)lines.push("Rückfahrt mit WEINmobil ab "+res.lastStop.p.name+" nach "+opts.start.name+", Tel. "+WEINMOBIL.phone);lines.push("Gesamt "+fmtKm(res.km)+", Gehzeit "+fmtMin(res.walkMin)+(res.ascent?", "+Math.round(res.ascent)+" Hm":""));return lines.join("\n");}
function hoursText(p){if(p.oh)return p.oh;return "";}

function renderRoute(cur,opts){
  const out=$("#routeOut");
  if(!cur){out.innerHTML='<div class="card empty"><b>Keine Route gefunden</b>Weniger Einkehren wählen oder das Zeitfenster vergrößern.</div>';return;}
  const {res,opts:o}=cur;let n=0;const rows=[];
  res.items.forEach((it,i)=>{
    if(i>0){const l=it.leg;rows.push('<div class="leg"><span></span><span class="bar"></span><span>zu Fuß '+fmtKm(l.km)+' · ca. '+fmtMin(l.min)+(l.ascent?' · ↑'+Math.round(l.ascent)+' m':'')+(l.estimated?' (geschätzt)':'')+'</span></div>');}
    const isStop=it.role==="stop";if(isStop)n++;
    const cls=it.role==="sight"?"sight":(isStop?"":"edge");const done=DONE.has(it.p.id);
    const label=it.role==="start"?"S":it.role==="end"?"Z":it.role==="sight"?"◆":String(n);
    let flag="";
    if(it.open){if(it.open.s==="open")flag='<span class="flag ok">geöffnet bis '+hhmm(it.open.close)+'</span>';else if(it.open.s==="later")flag='<span class="flag">öffnet erst um '+hhmm(it.open.opens)+'</span>';else if(it.open.s==="closed")flag='<span class="flag">heute geschlossen</span>';else flag='<span class="flag" style="color:var(--muted)">'+(it.p.oh?'OSM: '+esc(it.p.oh):'Öffnungszeiten prüfen')+'</span>';}
    if(it.p.note&&/Voranmeldung|anrufen/i.test(it.p.note))flag+=' <span class="flag">Voranmeldung</span>';
    const mark=(isStop||it.role==="sight")?'<label class="mark"><input type="checkbox" data-done="'+esc(it.p.id)+'"'+(done?' checked':'')+'> erledigt</label>':'';
    rows.push('<div class="stop '+cls+(done?' done':'')+'"><div class="t">'+hhmm(it.arrive)+(it.stay?'<small>bis '+hhmm(it.depart)+'</small>':'')+'</div><div class="dot">'+label+'</div><div class="body"><b>'+esc(it.p.name)+'</b><p>'+esc(it.p.addr||"")+(it.p.note?' · '+esc(it.p.note):'')+(it.p.phone?' · <a href="tel:'+esc(String(it.p.phone).replace(/\s/g,""))+'">'+esc(it.p.phone)+'</a>':'')+'</p>'+flag+mark+'</div></div>');
  });
  let taxi="";
  if(o.returnMode==="taxi"&&res.lastStop){
    const pickup=res.lastStop.depart;const book=pickup-1.5;
    rows.push('<div class="leg"><span></span><span class="bar taxi"></span><span>WEINmobil zurück nach '+esc(o.start.name)+'</span></div>');
    rows.push('<div class="stop edge"><div class="t">'+hhmm(pickup)+'</div><div class="dot">🚕</div><div class="body"><b>Abholung bei '+esc(res.lastStop.p.name)+'</b><p>Rückfahrt zum Ausgangspunkt; Fahrt bis spätestens '+hhmm(book)+' buchen.</p></div></div>');
    taxi='<div class="card taxi stack"><div><span class="eyebrow">Rückfahrt</span><h3>'+WEINMOBIL.name+'</h3><p class="notice">'+WEINMOBIL.hint+'</p></div><div class="row"><span class="phone">'+WEINMOBIL.phone+'</span><button class="btn small ghost" type="button" id="copyPhone">Kopieren</button></div><div class="row"><a class="btn small" href="tel:'+WEINMOBIL.phoneRaw+'">Anrufen</a><a class="btn small ghost" href="'+WEINMOBIL.booking+'" target="_blank" rel="noopener">Online buchen</a><a class="btn small ghost" href="'+WEINMOBIL.web+'" target="_blank" rel="noopener">weinmobil.at</a></div><p class="notice">Abholpunkt: '+esc(res.lastStop.p.name)+', '+esc(res.lastStop.p.addr||"")+' → Ziel: '+esc(o.start.name)+'. Buchung bis '+hhmm(book)+' Uhr.</p></div>';
  }
  const stops=res.items.filter(i=>i.role==="stop").length;
  const warn=cur.warnings.length?'<div class="card" style="border-color:var(--sun)"><span class="eyebrow">Hinweise</span><ul style="margin:6px 0 0;padding-left:18px">'+[...new Set(cur.warnings)].map(w=>'<li>'+esc(w)+'</li>').join("")+'</ul></div>':"";
  out.innerHTML=
    '<div class="card"><span class="eyebrow">'+DOWN[o.dow]+', '+o.date.toLocaleDateString("de-AT")+(res.estimated?' · Gehzeiten geschätzt':' · Wege: openrouteservice')+'</span><h2>Ab '+esc(o.start.name)+'</h2>'+
    '<div class="summary"><div><b>'+fmtKm(res.km)+'</b><span>zu Fuß'+(res.ascent?' · ↑'+Math.round(res.ascent)+' m':'')+'</span></div><div><b>'+fmtMin(res.walkMin)+'</b><span>Gehzeit</span></div><div><b>'+stops+'</b><span>Einkehren · je '+res.stayUsed+' min</span></div></div>'+
    '<div class="row" style="margin-top:12px"><button class="btn small" type="button" id="toMap">Auf der Karte</button><button class="btn small ghost" type="button" id="shareBtn">Teilen</button><a class="btn small ghost" href="'+mapsLink(res.items)+'" target="_blank" rel="noopener">Google Maps</a></div></div>'+
    warn+
    '<div class="card"><span class="eyebrow">Tagesplan</span><div class="timeline">'+rows.join("")+'</div></div>'+
    '<div class="card stack" style="border-left:4px solid var(--wine)"><div><span class="eyebrow">Unterwegs</span><h3>Zeitplan verrutscht?</h3><p class="notice">Erledigte Stopps abhaken und ab jetzt neu planen: Start ist dein GPS-Standort (oder der letzte erledigte Stopp), Startzeit ist jetzt, die restlichen Einkehren werden neu gelegt, die Weintaxi-Zeit wandert mit.</p></div><button class="btn wide" type="button" id="replanNow">Ab jetzt neu planen</button></div>'+
    taxi+
    '<div class="card"><div class="row"><button class="btn ghost" type="button" id="copyRoute">Plan kopieren</button><button class="btn ghost" type="button" id="replan">Eingaben ändern</button></div></div>';
  const cp=$("#copyPhone");if(cp)cp.addEventListener("click",()=>copy(WEINMOBIL.phone));
  $("#copyRoute").addEventListener("click",()=>copy(routeText(cur)));
  $("#replan").addEventListener("click",()=>showTab("tab-plan"));
  $("#toMap").addEventListener("click",()=>{showTab("tab-map");fitRoute();});
  $("#replanNow").addEventListener("click",replanFromNow);
  $("#shareBtn").addEventListener("click",async()=>{const text=routeText(cur);if(navigator.share){try{await navigator.share({title:"Weinweg Südsteiermark",text});}catch(e){}}else copy(text);});
  out.querySelectorAll("[data-done]").forEach(cb=>cb.addEventListener("change",()=>{if(cb.checked)DONE.add(cb.dataset.done);else DONE.delete(cb.dataset.done);cb.closest(".stop").classList.toggle("done",cb.checked);}));
}

// ---------- Karte ----------
let map=null,layerAll=null,layerRoute=null,meMarker=null;
function initMap(){
  if(typeof L==="undefined"){$("#mapStatus").textContent="Karte konnte nicht geladen werden.";return;}
  map=L.map("map",{zoomControl:true});
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'}).addTo(map);
  const [s,w,n,e]=C.BBOX;map.fitBounds([[s,w],[n,e]]);
  layerAll=L.layerGroup().addTo(map);layerRoute=L.layerGroup().addTo(map);
  drawAllPlaces();
}
const pin=(cls,label)=>L.divIcon({className:"",html:'<div class="ww-pin '+cls+'">'+(label||"")+'</div>',iconSize:[26,26],iconAnchor:[13,13],popupAnchor:[0,-12]});
function popupHtml(p){
  const hours=p.oh?'<div>Öffnungszeiten (OSM): '+esc(p.oh)+'</div>':(p.note?'<div>'+esc(p.note)+'</div>':'');
  return '<b>'+esc(p.name)+'</b><div>'+esc(p.addr||"")+'</div>'+hours+(p.phone?'<div><a href="tel:'+esc(String(p.phone).replace(/\s/g,""))+'">'+esc(p.phone)+'</a></div>':'')+(p.web?'<div><a href="'+esc(/^https?:/.test(p.web)?p.web:"https://"+p.web)+'" target="_blank" rel="noopener">Website</a></div>':'')+(p.kind!=="sight"?'<button class="btn small" type="button" data-asstart="'+esc(p.id)+'">Als Startpunkt</button>':'');
}
function drawAllPlaces(){
  if(!map)return;layerAll.clearLayers();
  for(const p of allPlaces()){
    if(p.temp)continue;
    const cls=(p.kind==="sight"?"sight":p.kind==="start"?"edge":"")+" faint";
    L.marker([p.lat,p.lon],{icon:pin(cls,"")}).bindPopup(popupHtml(p)).addTo(layerAll);
  }
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-asstart]");if(!b)return;$("#start").value=b.dataset.asstart;if(map)map.closePopup();showTab("tab-plan");toast("Startpunkt gesetzt");});
function drawRoute(cur){
  if(!map)return;layerRoute.clearLayers();if(!cur)return;
  const pts=cur.route.map(r=>[r.p.lat,r.p.lon]);
  if(cur.geometry)L.polyline(cur.geometry,{color:"#398140",weight:5,opacity:.9}).addTo(layerRoute);
  else L.polyline(pts,{color:"#398140",weight:4,dashArray:"8 6",opacity:.8}).addTo(layerRoute);
  if(cur.opts.returnMode==="taxi"&&cur.res.lastStop)L.polyline([[cur.res.lastStop.p.lat,cur.res.lastStop.p.lon],[cur.opts.start.lat,cur.opts.start.lon]],{color:"#d9a441",weight:3,dashArray:"2 8"}).addTo(layerRoute);
  let n=0;
  cur.res.items.forEach(it=>{const isStop=it.role==="stop";if(isStop)n++;const cls=it.role==="sight"?"sight":isStop?"":"edge";const label=it.role==="start"?"S":it.role==="end"?"Z":isStop?String(n):"";
    L.marker([it.p.lat,it.p.lon],{icon:pin(cls,label),zIndexOffset:500}).bindPopup('<div>'+hhmm(it.arrive)+(it.stay?' – '+hhmm(it.depart):'')+'</div>'+popupHtml(it.p)).addTo(layerRoute);});
  fitRoute();
}
function fitRoute(){if(!map||!current)return;const pts=current.geometry||current.route.map(r=>[r.p.lat,r.p.lon]);map.fitBounds(L.latLngBounds(pts).pad(0.12));}
function updateMe(){if(!map||!mePos)return;if(!meMarker){meMarker=L.marker([mePos.lat,mePos.lon],{icon:L.divIcon({className:"",html:'<div class="ww-me"></div>',iconSize:[18,18],iconAnchor:[9,9]}),zIndexOffset:1000}).addTo(map);}else meMarker.setLatLng([mePos.lat,mePos.lon]);}
$("#locBtn").addEventListener("click",async()=>{try{$("#mapStatus").textContent="Standort wird ermittelt…";const c=await getPosition();mePos={lat:c.latitude,lon:c.longitude};updateMe();map.setView([mePos.lat,mePos.lon],15);$("#mapStatus").textContent="";}catch(e){$("#mapStatus").textContent=e.message;}});
$("#fitBtn").addEventListener("click",fitRoute);

// ---------- Betriebe ----------
let placeKind="all";
function renderPlaces(){
  const ps=allPlaces().filter(p=>p.kind!=="start"&&(placeKind==="all"||p.kind===placeKind)).sort((a,b)=>a.name.localeCompare(b.name,"de"));
  const kindName={buschenschank:"Buschenschank",gasthaus:"Gasthaus",sight:"Wegpunkt"};
  $("#placeList").innerHTML=ps.map(p=>'<div class="place" data-id="'+esc(p.id)+'"><div><b>'+esc(p.name)+'</b><p>'+esc(p.addr||"")+(p.phone?' · '+esc(p.phone):'')+'</p>'+(p.note?'<p>'+esc(p.note)+'</p>':'')+(p.oh?'<p>Öffnungszeiten (OSM): '+esc(p.oh)+'</p>':'')+'<div><span class="tag w">'+kindName[p.kind]+'</span>'+(p.verified?'<span class="tag">OSM-verortet</span>':p.source==="osm"?'<span class="tag">aus OSM</span>':'')+(p.tags||[]).map(t=>'<span class="tag">'+esc(t)+'</span>').join("")+'</div></div><button class="btn small ghost edit" type="button" data-edit="'+esc(p.id)+'">Lage</button></div>').join("")||'<div class="empty"><b>Keine Einträge</b></div>';
}
renderPlaces();
$("#placeFilter").addEventListener("click",e=>{const b=e.target.closest("[data-k]");if(!b)return;placeKind=b.dataset.k;$("#placeFilter").querySelectorAll(".chip").forEach(c=>c.dataset.on=c===b?"1":"0");renderPlaces();});
$("#placeList").addEventListener("click",e=>{
  const b=e.target.closest("[data-edit]");if(!b)return;const id=b.dataset.edit;const p=byId(id);const row=b.closest(".place");
  if(row.querySelector(".editor"))return;
  const ed=document.createElement("div");ed.className="editor stack";ed.style.gridColumn="1 / -1";
  ed.innerHTML='<div class="grid2"><label class="f">Breite (lat)<input value="'+p.lat+'" inputmode="decimal"></label><label class="f">Länge (lon)<input value="'+p.lon+'" inputmode="decimal"></label></div><div class="row"><button class="btn small" type="button">Übernehmen</button><button class="btn small ghost" type="button">Abbrechen</button>'+(p.source==="osm"?'<button class="btn small ghost" type="button" data-hide="1">Ausblenden</button>':'')+'</div>';
  row.appendChild(ed);const [la,lo]=ed.querySelectorAll("input");const [ok,cancel,hide]=ed.querySelectorAll("button");
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

// ---------- Start ----------
initMap();
loadOSM(false).then(()=>{ // Testroute beim Öffnen: Ehrenhausen Kirchenplatz, 10–18 Uhr, 5 Buschenschanken, Weintaxi
  if(!current)runPlan(readOpts());
});
})();
