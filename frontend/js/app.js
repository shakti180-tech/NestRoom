// Dashboard – requires login. The role comes from the server-verified session.
if (!Session.token || !Session.user) { location.replace("login.html"); }

const TYPES=["Single room","Double sharing","Triple sharing","Studio flat","1 BHK"];
const BT={pending:"Pending",approved:"Approved",leaving:"Leave requested",rejected:"Rejected",cancelled:"Cancelled",ended:"Ended"};
const AMENITIES=["WiFi","AC","Food","Gym","Parking","Laundry","Power backup","Attached bath"];
const CITIES=["Mumbai","Bangalore","Delhi","Pune","Hyderabad","Kolkata","Chennai","Ahmedabad","Jaipur","Lucknow"];
const MAX_PHOTOS=6;
const newDraft=()=>({name:"",addr:"",city:"",type:TYPES[0],rent:"",desc:"",amen:[]});
let draft=newDraft(), pendingImages=[];   // owner "add room" form state (kept across re-renders)
let rooms=[], bookings=[], owners=[], q="", tf="all";
let me=Session.user||{}, role=me.role;

const $=s=>document.querySelector(s), inr=n=>"₹"+n.toLocaleString("en-IN");
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cnt=(a,s)=>a.filter(r=>r.status===s).length;
const day=iso=>new Date(iso).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
const cap=s=>s[0].toUpperCase()+s.slice(1);
const tel=p=>p?`<a href="tel:${esc(String(p).replace(/[^\d+]/g,""))}">${esc(p)}</a>`:"";

function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");setTimeout(()=>e.classList.remove("on"),1800)}
function stat(n,l,big,alert){return `<div class="stat${big?" big":""}${alert?" alert":""}"><b>${n}</b><span>${l}</span></div>`}
function filters(){return `<div class="tools"><input type="search" id="q" placeholder="Search by name or address" value="${esc(q)}" aria-label="Search"><select id="tf" aria-label="Room type"><option value="all">All types</option>${TYPES.map(t=>`<option ${tf===t?"selected":""}>${t}</option>`).join("")}</select></div>`}
function match(r){return (tf==="all"||r.type===tf)&&(r.name+r.addr).toLowerCase().includes(q.toLowerCase())}
function list(items,empty){return `<div class="list">${items.length?items.join(""):`<div class="empty">${empty}</div>`}</div>`}
const ownerLine=o=>`<div class="meta contact">Owner: <b>${esc(o.owner)}</b>${o.ownerBusiness?` (${esc(o.ownerBusiness)})`:""}${o.ownerPhone?` · ${tel(o.ownerPhone)}`:""}</div>`;

// Room card. Tenants also see the owner's name and phone number.
const photo=id=>id?`<img class="thumb" src="${API.img(id)}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('has-img');this.remove()">`:"";
function card(r,act){
  const img=r.images&&r.images[0];
  return `<article class="row${img?" has-img":""}">${photo(img)}<h3>${esc(r.name)}</h3><div class="addr">${esc(r.addr)}</div><div class="meta"><span class="tag">${r.type}</span>${r.city?`<span class="tag">${esc(r.city)}</span>`:""}<span class="tag s-${r.status}">${cap(r.status)}</span>${role==="admin"?`<span>Owner: ${esc(r.owner)}</span>`:""}</div>${role==="user"?ownerLine(r):""}<div class="act"><span class="rent">${inr(r.rent)}<small>/mo</small></span>${act||""}</div></article>`;
}

// Booking record. Owners/admin see tenant details; tenants see owner details.
function bookingCard(b,act){
  const tenant=role!=="user"?`<div class="meta contact">Tenant: <b>${esc(b.tenant)}</b>${b.tenantPhone?` · ${tel(b.tenantPhone)}`:""}${b.tenantEmail?` · ${esc(b.tenantEmail)}`:""}</div>`:"";
  const owner=role!=="owner"?ownerLine(b):"";
  const leave=b.status==="leaving"&&b.leaveRequestedAt?`<span>Leave requested ${day(b.leaveRequestedAt)}</span>`:"";
  return `<article class="row${b.roomImage?" has-img":""}">${photo(b.roomImage)}<h3>${esc(b.roomName)}</h3><div class="addr">${esc(b.roomAddr)}</div><div class="meta"><span class="tag">${esc(b.roomType)}</span><span class="tag b-${b.status}">${BT[b.status]}</span><span>Requested ${day(b.createdAt)}</span>${leave}</div>${tenant}${owner}<div class="act"><span class="rent">${inr(b.rent)}<small>/mo</small></span>${act||""}</div></article>`;
}

// Admin: owner card with all of that owner's rooms and bookings
function ownerCard(o){
  const act=(o.status==="pending"?`<button class="btn" data-ook="${o.id}">Approve</button><button class="btn bad" data-ono="${o.id}">Reject</button>`
    :o.status==="approved"?`<button class="btn ghost" data-ono="${o.id}">Revoke</button>`
    :`<button class="btn" data-ook="${o.id}">Approve</button>`)+`<button class="btn bad" data-orem="${o.id}" data-name="${esc(o.name)}">Remove</button>`;
  const rs=rooms.filter(r=>r.ownerId===o.id), bs=bookings.filter(b=>b.ownerId===o.id);
  const roomsHtml=rs.length?rs.map(r=>`<div class="mini"><b>${esc(r.name)}</b><span>${r.type}</span><span>${inr(r.rent)}/mo</span><span class="tag s-${r.status}">${cap(r.status)}</span></div>`).join(""):'<div class="mini">No rooms listed</div>';
  const bksHtml=bs.length?bs.map(b=>`<div class="mini"><b>${esc(b.tenant)}</b>${b.tenantPhone?`<span>${tel(b.tenantPhone)}</span>`:""}<span>${esc(b.roomName)}</span><span class="tag b-${b.status}">${BT[b.status]}</span><span>${day(b.createdAt)}</span></div>`).join(""):'<div class="mini">No bookings yet</div>';
  return `<article class="row"><h3>${esc(o.name)}${o.business?` <small style="font-weight:400;color:var(--mute)">· ${esc(o.business)}</small>`:""}</h3><div class="addr">@${esc(o.username)} · ${esc(o.email)} · ${tel(o.phone)}</div><div class="meta"><span class="tag b-${o.status}">${cap(o.status)}</span><span>${rs.length} room${rs.length===1?"":"s"}</span><span>${bs.length} booking${bs.length===1?"":"s"}</span><span>Registered ${day(o.createdAt)}</span></div><div class="act">${act}</div><details class="detail"><summary>Rooms &amp; bookings</summary><h4>Rooms</h4>${roomsHtml}<h4>Bookings</h4>${bksHtml}</details></article>`;
}

// ----- owner: add room form with photo upload -----
function previewsHtml(){
  return pendingImages.length?pendingImages.map((d,i)=>`<div class="pv"><img src="${d}" alt="Photo ${i+1}">${i===0?'<span class="cover">Cover</span>':""}<button type="button" class="rm" data-rmimg="${i}" aria-label="Remove photo ${i+1}">×</button></div>`).join(""):'<p class="hint">No photos added yet.</p>';
}
function addForm(){
  return `<div class="panel addform">
  <div class="fgrid">
    <div class="f"><label for="n-name">Room / PG name</label><input id="n-name" value="${esc(draft.name)}" placeholder="e.g. Sunrise PG – 101"></div>
    <div class="f"><label for="n-city">City</label><input id="n-city" list="n-cities" value="${esc(draft.city)}" placeholder="e.g. Mumbai"><datalist id="n-cities">${CITIES.map(c=>`<option value="${c}">`).join("")}</datalist></div>
    <div class="f wide"><label for="n-addr">Address / area</label><input id="n-addr" value="${esc(draft.addr)}" placeholder="Street, locality"></div>
    <div class="f"><label for="n-type">Type</label><select id="n-type">${TYPES.map(t=>`<option ${draft.type===t?"selected":""}>${t}</option>`).join("")}</select></div>
    <div class="f"><label for="n-rent">Rent per month (₹)</label><input id="n-rent" type="number" min="0" value="${esc(draft.rent)}" placeholder="e.g. 6000"></div>
  </div>
  <div class="f"><span>Amenities</span><div class="amen">${AMENITIES.map(a=>`<label class="amen-i"><input type="checkbox" data-amen="${esc(a)}" ${draft.amen.includes(a)?"checked":""}> ${a}</label>`).join("")}</div></div>
  <div class="f"><label for="n-desc">Description (optional)</label><textarea id="n-desc" rows="3" maxlength="500" placeholder="Rules, nearby places, what is included…">${esc(draft.desc)}</textarea></div>
  <div class="f"><span>Photos <b>*</b> <small style="font-weight:400">(add 1–${MAX_PHOTOS}; the first is the cover)</small></span>
    <label class="drop" for="n-files"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>Choose photos</label>
    <input type="file" id="n-files" accept="image/*" multiple hidden>
    <div class="previews" id="n-previews">${previewsHtml()}</div></div>
  <div><button class="btn" id="add">Add room</button></div></div>`;
}
// shrink a photo in the browser (max 1280px JPEG) so uploads stay small
function shrink(file,max=1280){
  return new Promise((res,rej)=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{
      const k=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");
      c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
      const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url);
      let qlt=.82,d=c.toDataURL("image/jpeg",qlt);
      while(d.length>780000&&qlt>.4){qlt-=.1;d=c.toDataURL("image/jpeg",qlt)}
      res(d);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error(`Could not read "${file.name}"`))};
    img.src=url;
  });
}
async function addFiles(files){
  const room=MAX_PHOTOS-pendingImages.length;
  if(room<=0)return toast(`You can add up to ${MAX_PHOTOS} photos`);
  const imgs=files.filter(f=>f.type.startsWith("image/")).slice(0,room);
  if(files.length>imgs.length)toast(`Only images are accepted (max ${MAX_PHOTOS})`);
  for(const f of imgs){try{pendingImages.push(await shrink(f))}catch(e){toast(e.message)}}
  const box=$("#n-previews");if(box)box.innerHTML=previewsHtml();
}

function view(){
  const h={user:"Welcome, "+me.name,admin:"Monitoring all owners, rooms and bookings",owner:"Managing properties of "+me.name}[role];$("#who").textContent=h;
  $("#chip").innerHTML=esc(me.name)+"<em>"+role+"</em>";
  const av=cnt(rooms,"available");let s="",m="";
  if(role==="user"){
    const active=bookings.filter(b=>["pending","approved","leaving"].includes(b.status)).length;
    s=stat(rooms.length,"Total rooms",1)+stat(av,"Available now")+stat(active,"My active bookings");
    const l=rooms.filter(r=>r.status==="available"&&match(r));
    m=`<h2>Available rooms</h2>${filters()}${list(l.map(r=>card(r,`<button class="btn" data-book="${r.id}">Book room</button>`)),"No rooms match. Clear the search or pick another type.")}`;
    if(bookings.length)m+=`<h2>My bookings</h2><p class="sec-note">The owner approves your booking and your request to leave.</p>${list(bookings.map(b=>bookingCard(b,
      b.status==="pending"?`<button class="btn bad" data-bcancel="${b.id}">Cancel request</button>`
      :b.status==="approved"?`<button class="btn ghost" data-bleave="${b.id}">Leave room</button>`
      :b.status==="leaving"?`<button class="btn ghost" data-bwithdraw="${b.id}">Withdraw leave request</button>`:"")))}`;
  }else if(role==="admin"){
    const pb=cnt(bookings,"pending"), lv=cnt(bookings,"leaving");
    const po=cnt(owners,"pending"), ao=cnt(owners,"approved");
    s=stat(rooms.length,"Total rooms",1)+stat(av,"Available")+stat(cnt(rooms,"booked"),"Booked")+stat(pb,"Bookings awaiting owner",0,pb)+stat(lv,"Leave requests",0,lv)+stat(po,"Owners awaiting approval",0,po)+stat(ao,"Approved owners");
    m=`<h2>Owners</h2><p class="sec-note">Approve new owners, review their rooms and bookings, or remove an owner (their rooms are deleted and active bookings cancelled).</p>${list(owners.map(ownerCard),"No owners have registered yet.")}
    <h2>All bookings</h2><p class="sec-note">Owners approve or reject bookings and leave requests; you can monitor everything here.</p>${list(bookings.map(b=>bookingCard(b)),"No bookings yet.")}
    <h2>Room types</h2><div class="panel bars">${TYPES.map(t=>{const n=rooms.filter(r=>r.type===t).length;return `<div class="bar"><span>${t}</span><i><u style="width:${rooms.length?n/rooms.length*100:0}%"></u></i><span>${n} rooms</span></div>`}).join("")}</div>
    <h2>All rooms</h2>${filters()}${list(rooms.filter(match).map(r=>card(r,`<button class="btn bad" data-del="${r.id}">Remove</button>`)),"No rooms match.")}`;
  }else{
    const mine=rooms.filter(r=>r.ownerId===me.id),b=cnt(mine,"booked"),inc=mine.filter(r=>r.status==="booked").reduce((a,r)=>a+r.rent,0);
    const pend=bookings.filter(x=>x.status==="pending"), lv=bookings.filter(x=>x.status==="leaving"), rest=bookings.filter(x=>!["pending","leaving"].includes(x.status));
    s=stat(mine.length,"My total rooms",1)+stat(cnt(mine,"available"),"Vacant")+stat(b,"Occupied")+stat(inr(inc),"Monthly income")+stat(pend.length,"Booking requests",0,pend.length)+stat(lv.length,"Leave requests",0,lv.length);
    m=`<h2>Booking requests</h2>${list(pend.map(x=>bookingCard(x,`<span><button class="btn" data-bok="${x.id}">Approve</button> <button class="btn bad" data-bno="${x.id}">Reject</button></span>`)),"No booking requests waiting for you.")}
    <h2>Leave requests</h2><p class="sec-note">Tenants asking to vacate. Approving frees the room.</p>${list(lv.map(x=>bookingCard(x,`<span><button class="btn" data-lok="${x.id}">Approve leave</button> <button class="btn bad" data-lno="${x.id}">Reject</button></span>`)),"No leave requests.")}
    <h2>Booking history</h2>${list(rest.map(x=>bookingCard(x)),"No bookings on your rooms yet.")}
    <h2>Add a room / PG / flat</h2>${addForm()}
    <h2>My rooms</h2>${list(mine.map(r=>card(r,r.status==="booked"?`<button class="btn ghost" data-free="${r.id}">Mark vacant</button>`:`<button class="btn bad" data-del="${r.id}">Remove</button>`)),"You have not added any rooms yet.")}`;
  }
  const open=[...document.querySelectorAll("details.detail[open]")].map(d=>d.closest("article").querySelector("h3").textContent);
  $("#stats").innerHTML=s;$("#main").innerHTML=m;
  document.querySelectorAll("details.detail").forEach(d=>{if(open.includes(d.closest("article").querySelector("h3").textContent))d.open=true}); // keep expanded owners open across refreshes
}

async function refresh(){
  try{
    [rooms,bookings]=await Promise.all([API.getRooms(),API.getBookings()]);
    if(role==="admin")owners=await API.getOwners();
  }catch(e){toast(e.message);}
  view();
}

document.addEventListener("click",async e=>{
  const t=e.target.closest("button")||e.target,d=t.dataset;if(!d)return;
  if(t.id==="logout"){Session.clear();location.href="login.html";return}
  if(d.rmimg!==undefined){pendingImages.splice(+d.rmimg,1);$("#n-previews").innerHTML=previewsHtml();return}
  const id=(d.book||d.bcancel||d.bleave||d.bwithdraw||d.bok||d.bno||d.lok||d.lno||d.ook||d.ono||d.orem||d.del||d.free);
  try{
    if(d.book){await API.book(id);toast("Booking request sent to the owner")}
    else if(d.bcancel){await API.cancelBooking(id);toast("Request cancelled")}
    else if(d.bleave){if(!confirm("Send a request to the owner to leave this room?"))return;await API.leaveBooking(id);toast("Leave request sent to the owner")}
    else if(d.bwithdraw){await API.withdrawLeave(id);toast("Leave request withdrawn")}
    else if(d.bok){await API.approveBooking(id);toast("Booking approved")}
    else if(d.bno){await API.rejectBooking(id);toast("Booking rejected")}
    else if(d.lok){await API.approveLeave(id);toast("Leave approved – room is vacant again")}
    else if(d.lno){await API.rejectLeave(id);toast("Leave request rejected")}
    else if(d.ook){await API.approveOwner(id);toast("Owner approved")}
    else if(d.ono){await API.rejectOwner(id);toast("Owner rejected")}
    else if(d.orem){if(!confirm(`Remove owner "${d.name}"? Their rooms will be deleted and active bookings cancelled. This cannot be undone.`))return;await API.removeOwner(id);toast("Owner removed")}
    else if(d.del){await API.removeRoom(id);toast("Room removed")}
    else if(d.free){await API.markVacant(id);toast("Marked vacant")}
    else if(t.id==="add"){
      const rent=+draft.rent;
      if(!draft.name.trim()||!draft.city.trim()||!draft.addr.trim()||!(rent>0))return toast("Enter name, city, address and rent");
      if(!pendingImages.length)return toast("Please add at least one photo of the room");
      t.disabled=true;t.textContent="Uploading…";
      await API.addRoom({name:draft.name.trim(),addr:draft.addr.trim(),city:draft.city.trim(),type:draft.type,rent,amenities:draft.amen,description:draft.desc.trim(),images:pendingImages});
      draft=newDraft();pendingImages=[];toast("Room added with photos");
    } else return;
  }catch(err){toast(err.message)}
  refresh();
});
const DRAFT_FIELDS={"n-name":"name","n-addr":"addr","n-city":"city","n-rent":"rent","n-desc":"desc"};
document.addEventListener("input",e=>{if(DRAFT_FIELDS[e.target.id]){draft[DRAFT_FIELDS[e.target.id]]=e.target.value;return}if(e.target.id==="q"){q=e.target.value;const p=e.target.selectionStart;view();const i=$("#q");i.focus();i.setSelectionRange(p,p)}});
document.addEventListener("change",async e=>{
  const t=e.target;
  if(t.id==="tf"){tf=t.value;view()}
  else if(t.id==="n-type")draft.type=t.value;
  else if(t.dataset&&t.dataset.amen){const a=t.dataset.amen;draft.amen=t.checked?[...new Set([...draft.amen,a])]:draft.amen.filter(x=>x!==a)}
  else if(t.id==="n-files"){const f=[...t.files];t.value="";await addFiles(f)}
});

// Confirm the session with the server, then load data; auto-refresh so new
// owners / bookings show up (skipped while the person is typing in a field).
if(Session.token){
  API.me().then(r=>{me=r.user;role=me.role;Session.set(Session.token,me);refresh();
    setInterval(()=>{if(!document.activeElement||!document.activeElement.matches("input,select,textarea"))refresh()},20000);
  }).catch(()=>{});
}
