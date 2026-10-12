// Public landing page: browse rooms, filter, view photos; log in to contact owners / book.
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const inr=n=>"₹"+Number(n).toLocaleString("en-IN");
const PIN='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const USER='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';
const HOUSE='<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>';
const tel=p=>p?`<a href="tel:${esc(String(p).replace(/[^\d+]/g,""))}">${esc(p)}</a>`:"";

let rooms=[], city="All", query="", type="all", current=null, shot=0;
const me=Session.user;

function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");setTimeout(()=>e.classList.remove("on"),2200)}

// ----- nav buttons depend on login state -----
function nav(){
  $("#navActions").innerHTML=me
    ?`<a class="btn solid" href="dashboard.html">Dashboard</a><button class="btn ghost" id="logout">Log out</button>`
    :`<a class="btn ghost" href="login.html">Login</a><a class="btn solid" href="register-user.html">Register</a>`;
}

// ----- data -----
async function load(){
  try{
    if(Session.token){
      try{rooms=await API.getRooms(true)}catch{Session.clear();rooms=await API.publicRooms()}
    }else rooms=await API.publicRooms();
    rooms=rooms.filter(r=>r.status==="available");
  }catch(e){
    $("#grid").innerHTML=`<p class="state">Could not load rooms. Is the server running?</p>`;return;
  }
  const types=[...new Set(rooms.map(r=>r.type))].sort();
  $("#typeFilter").innerHTML='<option value="all">All types</option>'+types.map(t=>`<option>${esc(t)}</option>`).join("");
  render();
}

// ----- list -----
function filtered(){
  const q=query.trim().toLowerCase();
  return rooms.filter(r=>(city==="All"||r.city===city)&&(type==="all"||r.type===type)
    &&(!q||[r.name,r.addr,r.city,r.type,r.owner,...(r.amenities||[])].join(" ").toLowerCase().includes(q)));
}
function render(){
  const cities=[...new Set(rooms.map(r=>r.city))].sort();
  if(city!=="All"&&!cities.includes(city))city="All";
  $("#chips").innerHTML=["All",...cities].map(c=>`<button class="chip-b" data-city="${esc(c)}" aria-pressed="${c===city}">${c==="All"?"All Cities":esc(c)}</button>`).join("");
  const list=filtered();
  $("#count").textContent=`${list.length} accommodation${list.length===1?"":"s"} found`;
  $("#grid").innerHTML=list.length?list.map(cardHtml).join(""):`<p class="state">No rooms match your search. Try another city or clear the filters.</p>`;
}
function cardHtml(r){
  const img=r.images&&r.images[0], n=(r.images||[]).length, am=r.amenities||[];
  return `<button class="pcard" data-open="${r.id}" aria-label="View ${esc(r.name)}">
    <div class="pimg">${img?`<img src="${API.img(img)}" alt="${esc(r.name)}" loading="lazy" onerror="this.remove()">`:HOUSE}${n>1?`<span class="pcount">${n} photos</span>`:""}</div>
    <div class="pbody"><h3>${esc(r.name)}</h3><span class="ptype">${esc(r.type)}</span>
      <span class="ploc">${PIN}${esc(r.addr)}${r.city&&!r.addr.toLowerCase().includes(r.city.toLowerCase())?`, ${esc(r.city)}`:""}</span>
      <div class="pprice">${inr(r.rent)} <small>/ month</small></div>
      <div class="ptags">${am.slice(0,4).map(a=>`<span>${esc(a)}</span>`).join("")}${am.length>4?`<span>+${am.length-4}</span>`:""}</div></div>
    <div class="pfoot"><span class="pown">${USER}<span>${esc(r.owner)}</span></span><span class="btn">Contact</span></div></button>`;
}

// ----- details modal -----
function openRoom(id){
  current=rooms.find(r=>r.id===id);if(!current)return;shot=0;drawModal();
  $("#modal").hidden=false;document.body.style.overflow="hidden";$("#mClose").focus();
}
function closeModal(){$("#modal").hidden=true;document.body.style.overflow="";current=null}
function drawModal(){
  const r=current,imgs=r.images||[],am=r.amenities||[];
  const gallery=`<div class="gal"><div class="gal-main">${imgs.length?`<img src="${API.img(imgs[shot])}" alt="${esc(r.name)} photo ${shot+1}">`:HOUSE}
    ${imgs.length>1?`<button class="gal-nav prev" data-nav="-1" aria-label="Previous photo">‹</button><button class="gal-nav next" data-nav="1" aria-label="Next photo">›</button>`:""}</div>
    ${imgs.length>1?`<div class="thumbs">${imgs.map((id,i)=>`<button data-shot="${i}" aria-current="${i===shot}" aria-label="Photo ${i+1}"><img src="${API.img(id)}" alt=""></button>`).join("")}</div>`:""}</div>`;
  let contact;
  if(!me)contact=`<div class="owner"><b>Owner: ${esc(r.owner)}</b><span class="muted">Log in to see the owner's phone number and book this room.</span></div>
    <div class="mact"><a class="btn" href="login.html">Login</a><a class="btn ghost" href="register-user.html">Register</a></div>`;
  else{
    contact=`<div class="owner"><b>Owner: ${esc(r.owner)}${r.ownerBusiness?` (${esc(r.ownerBusiness)})`:""}</b>${r.ownerPhone?`<span>Phone: ${tel(r.ownerPhone)}</span>`:""}</div>`;
    contact+=me.role==="user"?`<div class="mact"><button class="btn" id="bookBtn">Request booking</button>${r.ownerPhone?`<a class="btn ghost" href="tel:${esc(String(r.ownerPhone).replace(/[^\d+]/g,""))}">Call owner</a>`:""}</div>`
      :`<p class="muted" style="margin:0">Log in with a user account to book rooms.</p>`;
  }
  $("#mBody").innerHTML=`<div class="mgrid">${gallery}<div class="minfo"><h3 id="mTitle">${esc(r.name)}</h3>
    <span class="ptype">${esc(r.type)}</span><span class="ploc">${PIN}${esc(r.addr)}${r.city&&!r.addr.toLowerCase().includes(r.city.toLowerCase())?`, ${esc(r.city)}`:""}</span>
    <div class="pprice">${inr(r.rent)} <small>/ month</small></div>
    ${am.length?`<div class="ptags">${am.map(a=>`<span>${esc(a)}</span>`).join("")}</div>`:""}
    ${r.description?`<p class="desc">${esc(r.description)}</p>`:""}${contact}</div></div>`;
}

// ----- events -----
document.addEventListener("click",async e=>{
  const t=e.target.closest("button,a,[data-open]");if(!t)return;
  if(t.id==="logout"){Session.clear();location.reload();return}
  if(t.dataset.city!==undefined){city=t.dataset.city;render();return}
  if(t.dataset.open){openRoom(t.dataset.open);return}
  if(t.id==="mClose"||t.id==="modal"){closeModal();return}
  if(t.dataset.shot!==undefined){shot=+t.dataset.shot;drawModal();return}
  if(t.dataset.nav){const n=current.images.length;shot=(shot+ +t.dataset.nav+n)%n;drawModal();return}
  if(t.id==="bookBtn"){
    t.disabled=true;
    try{await API.book(current.id);closeModal();toast("Booking request sent! Track it in your dashboard.");await load()}
    catch(err){toast(err.message);t.disabled=false}
  }
});
$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
document.addEventListener("keydown",e=>{
  if($("#modal").hidden)return;
  if(e.key==="Escape")closeModal();
  if(current&&current.images&&current.images.length>1&&(e.key==="ArrowRight"||e.key==="ArrowLeft")){
    const n=current.images.length;shot=(shot+(e.key==="ArrowRight"?1:-1)+n)%n;drawModal();
  }
});
$("#searchForm").addEventListener("submit",e=>{e.preventDefault();query=$("#search").value;render();$("#properties").scrollIntoView({behavior:"smooth"})});
$("#search").addEventListener("input",e=>{query=e.target.value;render()});
$("#typeFilter").addEventListener("change",e=>{type=e.target.value;render()});

nav();load();
