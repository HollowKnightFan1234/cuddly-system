import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
const SUPABASE_KEY = "PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE";

/*
  This is a convenience gate, NOT the security boundary.
  Anyone who can inspect a public website can eventually discover a
  client-side gate. Real protection is Supabase Auth + RLS.
*/
const SHARED_PASSWORD = "CHANGE_ME";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.querySelector("#app");

const themes = {
  midnight: ["Midnight","🌌","#7c3aed","#0b1020","#121a2b"],
  ocean: ["Ocean","🌊","#0891b2","#071820","#0c2630"],
  forest: ["Forest","🌲","#16a34a","#08150d","#102419"],
  sakura: ["Sakura","🌸","#ec4899","#1b0c16","#29101f"],
  ember: ["Ember","🔥","#f97316","#190b07","#2a1109"],
  cloud: ["Cloud","☁️","#2563eb","#f5f7fb","#ffffff"],
  neon: ["Neon","💜","#d946ef","#09050f","#170c1f"],
  arctic: ["Arctic","🧊","#38bdf8","#07131d","#10222e"],
  sunset: ["Sunset","🌅","#f43f5e","#170b18","#28101f"],
  terminal: ["Terminal","💻","#22c55e","#050805","#0c120c"]
};

let state = {
  session: null,
  profile: null,
  users: [],
  conversations: [],
  currentConversation: null,
  messages: [],
  typing: false,
  presence: {},
  theme: localStorage.getItem("vibechat-theme") || "midnight",
  search: "",
  mobileSidebar: false
};

const esc = (s="") => String(s).replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[c]));

const initials = (name="User") => name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();

function toast(message, type="") {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function setTheme(name) {
  state.theme = name;
  localStorage.setItem("vibechat-theme", name);
  document.documentElement.dataset.theme = name;
  const t = themes[name];
  document.documentElement.style.setProperty("--accent", t[2]);
  document.documentElement.style.setProperty("--bg", t[3]);
  document.documentElement.style.setProperty("--surface", t[4]);
}

function gatePassed() {
  return sessionStorage.getItem("vibechat-gate") === "yes";
}

function gate() {
  app.innerHTML = `
    <div class="gate">
      <div class="gate-card">
        <div class="brand-mark">V</div>
        <h1>VibeChat</h1>
        <p>Enter the shared access password to continue.</p>
        <form id="gateForm">
          <input id="gatePassword" type="password" placeholder="Shared password" autocomplete="off" autofocus required>
          <button>Continue</button>
        </form>
        <small>After this, sign in with your personal account.</small>
      </div>
    </div>`;
  document.querySelector("#gateForm").onsubmit = e => {
    e.preventDefault();
    if (document.querySelector("#gatePassword").value === SHARED_PASSWORD) {
      sessionStorage.setItem("vibechat-gate","yes");
      boot();
    } else toast("Wrong shared password","error");
  };
}

function login() {
  app.innerHTML = `
    <div class="gate">
      <div class="gate-card">
        <div class="brand-mark">V</div>
        <h1>Welcome back</h1>
        <p>Sign in to VibeChat.</p>
        <form id="loginForm">
          <input id="email" type="email" placeholder="Email" autocomplete="email" required>
          <input id="password" type="password" placeholder="Password" autocomplete="current-password" required>
          <button>Log in</button>
        </form>
        <small>Accounts are created by an administrator. There is no public sign-up.</small>
      </div>
    </div>`;
  document.querySelector("#loginForm").onsubmit = async e => {
    e.preventDefault();
    const email = document.querySelector("#email").value.trim();
    const password = document.querySelector("#password").value;
    const { error } = await supabase.auth.signInWithPassword({email,password});
    if (error) toast(error.message,"error");
  };
}

async function loadProfile() {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", state.session.user.id).single();
  if (error) throw error;
  state.profile = data;
  setTheme(data.theme || state.theme);
}

async function loadUsers() {
  const { data, error } = await supabase.from("profiles").select("id,email,display_name,avatar_url,about,is_admin,last_seen").order("display_name");
  if (error) throw error;
  state.users = data || [];
}

async function loadConversations() {
  const { data, error } = await supabase
    .from("conversation_members")
    .select("conversation_id, conversations(id,title,is_group,created_at,updated_at), profiles(id,display_name,avatar_url)")
    .eq("user_id", state.session.user.id);
  if (error) throw error;

  const ids = [...new Set((data||[]).map(x=>x.conversation_id))];
  let rows = [];
  for (const id of ids) {
    const { data: members } = await supabase
      .from("conversation_members")
      .select("user_id, profiles(id,display_name,avatar_url,email)")
      .eq("conversation_id", id);
    const { data: latest } = await supabase
      .from("messages").select("content,created_at,sender_id").eq("conversation_id",id)
      .order("created_at",{ascending:false}).limit(1);
    const conv = data.find(x=>x.conversation_id===id)?.conversations;
    rows.push({...conv, members: members||[], latest: latest?.[0]||null});
  }
  rows.sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0));
  state.conversations = rows;
}

function userById(id) { return state.users.find(u=>u.id===id); }

function otherMembers(conv) {
  return (conv.members||[]).filter(m=>m.user_id!==state.session.user.id).map(m=>m.profiles).filter(Boolean);
}

function conversationName(conv) {
  if (conv.is_group && conv.title) return conv.title;
  const others = otherMembers(conv);
  return others.map(x=>x.display_name).join(", ") || "New conversation";
}

function avatar(name, url) {
  return url ? `<img src="${esc(url)}" alt="">` : `<span>${esc(initials(name))}</span>`;
}

function render() {
  if (!state.session) return login();
  setTheme(state.theme);
  const filtered = state.conversations.filter(c => {
    const q=state.search.toLowerCase();
    return !q || conversationName(c).toLowerCase().includes(q);
  });

  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar ${state.mobileSidebar?"open":""}">
      <div class="side-head">
        <div class="brand"><div class="brand-mark small">V</div><strong>VibeChat</strong></div>
        <button class="icon-btn" id="closeSide">×</button>
      </div>
      <div class="side-actions">
        <input id="searchChats" placeholder="🔎 Search chats" value="${esc(state.search)}">
        <button class="new-btn" id="newChat">＋ New chat</button>
      </div>
      <div class="chat-list">
        ${filtered.map(c=>`
          <button class="chat-row ${state.currentConversation?.id===c.id?"active":""}" data-cid="${c.id}">
            <div class="avatar">${avatar(conversationName(c), otherMembers(c)[0]?.avatar_url)}</div>
            <div class="chat-meta">
              <div><strong>${esc(conversationName(c))}</strong><time>${c.latest?new Date(c.latest.created_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}):""}</time></div>
              <p>${esc(c.latest?.content||"No messages yet")}</p>
            </div>
          </button>`).join("") || `<div class="empty-side">No conversations yet.<br>Start a new chat.</div>`}
      </div>
      <div class="side-bottom">
        <button id="profileBtn" class="profile-mini">
          <div class="avatar">${avatar(state.profile.display_name,state.profile.avatar_url)}</div>
          <span><strong>${esc(state.profile.display_name)}</strong><small>${state.profile.is_admin?"Administrator":"Online"}</small></span>
        </button>
        <button id="themeBtn" class="utility-btn">🎨 Theme</button>
        ${state.profile.is_admin ? `<button id="adminBtn" class="utility-btn">⚙️ Admin</button>`:""}
        <button id="logoutBtn" class="utility-btn">↪ Log out</button>
      </div>
    </aside>

    <main class="main">
      ${state.currentConversation ? chatView() : welcomeView()}
    </main>
  </div>
  <div id="modalRoot"></div>`;

  wire();
}

function welcomeView() {
  return `<div class="welcome"><div class="welcome-icon">💬</div><h2>Welcome to VibeChat</h2><p>Pick a conversation or start a new one.</p><button id="welcomeNew">＋ Start a chat</button></div>`;
}

function chatView() {
  const c=state.currentConversation;
  const name=conversationName(c);
  return `
  <div class="chat-head">
    <button class="icon-btn mobile-menu" id="openSide">☰</button>
    <div class="avatar">${avatar(name,otherMembers(c)[0]?.avatar_url)}</div>
    <div class="chat-title"><strong>${esc(name)}</strong><small>${c.is_group?`${c.members.length} members`:(state.presence[otherMembers(c)[0]?.id]?"● online":"last seen recently")}</small></div>
    <div class="head-actions"><button class="icon-btn" id="chatInfo">ⓘ</button></div>
  </div>
  <div class="messages" id="messages">
    ${state.messages.map(messageHTML).join("")}
  </div>
  <div class="typing" id="typing">${state.typing ? "Someone is typing…" : ""}</div>
  <form class="composer" id="composer">
    <label class="attach">＋<input id="fileInput" type="file" multiple hidden></label>
    <input id="messageInput" autocomplete="off" placeholder="Write a message…" maxlength="5000">
    <button>Send</button>
  </form>`;
}

function messageHTML(m) {
  const mine=m.sender_id===state.session.user.id;
  return `<div class="message ${mine?"mine":""}" data-mid="${m.id}">
    <div class="message-avatar">${avatar(m.profiles?.display_name||"User",m.profiles?.avatar_url)}</div>
    <div class="bubble-wrap">
      ${!mine?`<small class="sender">${esc(m.profiles?.display_name||"User")}</small>`:""}
      ${m.reply_to ? `<div class="reply-preview">↩ ${esc(m.reply_to.content||"Message")}</div>`:""}
      <div class="bubble">
        ${m.content ? `<div>${esc(m.content).replace(/\n/g,"<br>")}</div>`:""}
        ${m.attachments?.map(a=> attachmentHTML(a)).join("")||""}
        ${mine?`<span class="checks">${m.read_at?"✓✓":"✓"}</span>`:""}
      </div>
      <div class="message-meta">
        <time>${new Date(m.created_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</time>
        ${mine?`<button class="msg-more" data-edit="${m.id}">⋯</button>`:""}
      </div>
    </div>
  </div>`;
}

function attachmentHTML(a) {
  const isImage=/\.(png|jpe?g|gif|webp)$/i.test(a.name||"");
  return isImage ? `<a href="${esc(a.url)}" target="_blank"><img class="attachment-image" src="${esc(a.url)}" alt="${esc(a.name)}"></a>` :
    `<a class="file-card" href="${esc(a.url)}" target="_blank">📎 ${esc(a.name)}</a>`;
}

async function selectConversation(id) {
  state.currentConversation=state.conversations.find(c=>c.id===id)||null;
  state.mobileSidebar=false;
  if (!state.currentConversation) return render();
  const {data,error}=await supabase.from("messages")
    .select("*, profiles!messages_sender_id_fkey(id,display_name,avatar_url), reply_to:messages!messages_reply_to_id_fkey(id,content)")
    .eq("conversation_id",id).order("created_at");
  if(error){toast(error.message,"error");return;}
  state.messages=data||[];
  await supabase.from("messages").update({read_at:new Date().toISOString()})
    .eq("conversation_id",id).neq("sender_id",state.session.user.id).is("read_at",null);
  render();
  scrollMessages();
}

function scrollMessages(){setTimeout(()=>{const x=document.querySelector("#messages");if(x)x.scrollTop=x.scrollHeight},20)}

async function createChat() {
  const choices=state.users.filter(u=>u.id!==state.session.user.id);
  modal(`
    <div class="modal-card">
      <button class="modal-close">×</button><h2>New conversation</h2>
      <input id="userSearch" placeholder="Search people…">
      <div class="people" id="people">${peopleHTML(choices)}</div>
      <div class="modal-actions"><button class="primary" id="startChat">Start chat</button></div>
    </div>`);
  document.querySelector("#userSearch").oninput=e=>{
    const q=e.target.value.toLowerCase();
    document.querySelector("#people").innerHTML=peopleHTML(choices.filter(u=>(u.display_name+" "+u.email).toLowerCase().includes(q)));
  };
  document.querySelector("#startChat").onclick=async()=>{
    const selected=document.querySelector('input[name="person"]:checked');
    if(!selected){toast("Choose someone","error");return}
    const userId=selected.value;
    const existing=state.conversations.find(c=>!c.is_group && otherMembers(c).some(x=>x.id===userId));
    if(existing){closeModal();selectConversation(existing.id);return}
    const {data:c,error}=await supabase.from("conversations").insert({is_group:false}).select().single();
    if(error){toast(error.message,"error");return}
    const {error:e2}=await supabase.from("conversation_members").insert([
      {conversation_id:c.id,user_id:state.session.user.id},
      {conversation_id:c.id,user_id:userId}
    ]);
    if(e2){toast(e2.message,"error");return}
    closeModal(); await loadConversations(); await selectConversation(c.id);
  };
}

function peopleHTML(users){
  return users.map(u=>`<label class="person"><input type="radio" name="person" value="${u.id}"><div class="avatar">${avatar(u.display_name,u.avatar_url)}</div><div><strong>${esc(u.display_name)}</strong><small>${esc(u.email)}</small></div></label>`).join("") || `<p>No people found.</p>`;
}

function modal(html){document.querySelector("#modalRoot").innerHTML=`<div class="modal">${html}</div>`;document.querySelector(".modal-close").onclick=closeModal}
function closeModal(){document.querySelector("#modalRoot").innerHTML=""}

async function sendMessage(content, attachments=[]) {
  if(!state.currentConversation || (!content.trim() && !attachments.length)) return;
  const {error}=await supabase.from("messages").insert({
    conversation_id:state.currentConversation.id,
    sender_id:state.session.user.id,
    content:content.trim()||null,
    attachments
  });
  if(error) toast(error.message,"error");
}

async function uploadFiles(files) {
  const out=[];
  for(const file of files){
    const path=`${state.session.user.id}/${crypto.randomUUID()}-${file.name}`;
    const {error}=await supabase.storage.from("chat-files").upload(path,file);
    if(error){toast(error.message,"error");continue}
    const {data}=supabase.storage.from("chat-files").getPublicUrl(path);
    out.push({name:file.name,url:data.publicUrl,type:file.type,size:file.size});
  }
  return out;
}

function themeModal(){
  modal(`<div class="modal-card wide"><button class="modal-close">×</button><h2>Choose your vibe</h2><div class="themes">
  ${Object.entries(themes).map(([id,t])=>`<button class="theme-card ${state.theme===id?"selected":""}" data-theme="${id}"><span style="--preview:${t[2]};background:${t[3]}">${t[1]}</span><strong>${t[0]}</strong></button>`).join("")}
  </div><p class="muted">Your choice is saved to your profile.</p></div>`);
  document.querySelectorAll(".theme-card").forEach(b=>b.onclick=async()=>{
    setTheme(b.dataset.theme);
    await supabase.from("profiles").update({theme:b.dataset.theme}).eq("id",state.session.user.id);
    closeModal();render();
  });
}

function profileModal(){
  modal(`<div class="modal-card"><button class="modal-close">×</button><h2>Your profile</h2>
    <label>Name<input id="pName" value="${esc(state.profile.display_name)}"></label>
    <label>About<input id="pAbout" value="${esc(state.profile.about||"")}"></label>
    <label>Avatar URL<input id="pAvatar" value="${esc(state.profile.avatar_url||"")}"></label>
    <div class="modal-actions"><button class="primary" id="saveProfile">Save</button></div>
  </div>`);
  document.querySelector("#saveProfile").onclick=async()=>{
    const patch={display_name:document.querySelector("#pName").value.trim()||"User",about:document.querySelector("#pAbout").value.trim(),avatar_url:document.querySelector("#pAvatar").value.trim()};
    const {error}=await supabase.from("profiles").update(patch).eq("id",state.session.user.id);
    if(error){toast(error.message,"error");return}
    Object.assign(state.profile,patch);closeModal();render();toast("Profile updated");
  };
}

async function adminModal(){
  await loadUsers();
  modal(`<div class="modal-card admin-modal"><button class="modal-close">×</button><h2>Admin panel</h2>
    <div class="admin-create">
      <input id="newName" placeholder="Display name">
      <input id="newEmail" type="email" placeholder="Email">
      <input id="newPassword" type="password" placeholder="Temporary password">
      <button class="primary" id="createUser">Create account</button>
    </div>
    <div class="user-admin-list">${state.users.map(u=>`
      <div class="admin-user"><div class="avatar">${avatar(u.display_name,u.avatar_url)}</div>
        <div class="admin-user-info"><strong>${esc(u.display_name)}</strong><small>${esc(u.email)}</small></div>
        ${u.id!==state.session.user.id?`<button class="danger small" data-delete="${u.id}">Delete</button>`:"<span class=\"you\">You</span>"}
      </div>`).join("")}</div>
  </div>`);
  document.querySelector("#createUser").onclick=async()=>{
    const body={action:"create",display_name:document.querySelector("#newName").value.trim(),email:document.querySelector("#newEmail").value.trim(),password:document.querySelector("#newPassword").value};
    await adminRequest(body);
  };
  document.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{
    if(!confirm("Delete this account? This cannot be undone."))return;
    await adminRequest({action:"delete",user_id:b.dataset.delete});
  });
}

async function adminRequest(body){
  const {data,error}=await supabase.functions.invoke("admin",{body});
  if(error){toast(error.message,"error");return}
  if(data?.error){toast(data.error,"error");return}
  toast("Admin action complete"); await adminModal();
}

function wire(){
  document.querySelector("#searchChats")?.addEventListener("input",e=>{state.search=e.target.value;render()});
  document.querySelectorAll("[data-cid]").forEach(b=>b.onclick=()=>selectConversation(b.dataset.cid));
  document.querySelector("#newChat")?.addEventListener("click",createChat);
  document.querySelector("#welcomeNew")?.addEventListener("click",createChat);
  document.querySelector("#themeBtn")?.addEventListener("click",themeModal);
  document.querySelector("#profileBtn")?.addEventListener("click",profileModal);
  document.querySelector("#adminBtn")?.addEventListener("click",adminModal);
  document.querySelector("#logoutBtn")?.addEventListener("click",async()=>{await supabase.auth.signOut();});
  document.querySelector("#closeSide")?.addEventListener("click",()=>{state.mobileSidebar=false;render()});
  document.querySelector("#openSide")?.addEventListener("click",()=>{state.mobileSidebar=true;render()});
  document.querySelector("#chatInfo")?.addEventListener("click",()=>toast("Chat info and member management can be added here."));
  document.querySelector("#composer")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const input=document.querySelector("#messageInput"); const content=input.value;
    const files=[...(document.querySelector("#fileInput")?.files||[])];
    input.value=""; const attachments=files.length?await uploadFiles(files):[];
    await sendMessage(content,attachments);
  });
  document.querySelector("#fileInput")?.addEventListener("change",e=>{if(e.target.files.length)toast(`${e.target.files.length} file(s) ready to send`)});
  document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editMessage(b.dataset.edit));
  scrollMessages();
}

async function editMessage(id){
  const m=state.messages.find(x=>x.id===id); if(!m)return;
  const next=prompt("Edit message:",m.content||""); if(next===null)return;
  const {error}=await supabase.from("messages").update({content:next}).eq("id",id).eq("sender_id",state.session.user.id);
  if(error)toast(error.message,"error");
}

function subscribe(){
  supabase.channel("chat-changes")
    .on("postgres_changes",{event:"*",schema:"public",table:"messages"},async payload=>{
      if(!state.currentConversation || payload.new?.conversation_id!==state.currentConversation.id)return;
      if(payload.eventType==="INSERT"){
        const {data}=await supabase.from("messages").select("*, profiles!messages_sender_id_fkey(id,display_name,avatar_url)").eq("id",payload.new.id).single();
        if(data && !state.messages.some(x=>x.id===data.id)){state.messages.push(data);render();}
      } else if(payload.eventType==="UPDATE"){
        const i=state.messages.findIndex(x=>x.id===payload.new.id); if(i>=0)state.messages[i]={...state.messages[i],...payload.new};render();
      } else if(payload.eventType==="DELETE"){
        state.messages=state.messages.filter(x=>x.id!==payload.old.id);render();
      }
    })
    .subscribe();

  supabase.channel("presence")
    .on("presence",{event:"sync"},()=>{})
    .subscribe(async status=>{
      if(status==="SUBSCRIBED"){
        await supabase.channel("presence").track({user_id:state.session.user.id});
      }
    });
}

async function boot(){
  if(SUPABASE_URL.includes("PASTE_")) {
    app.innerHTML=`<div class="gate"><div class="gate-card"><h1>VibeChat setup needed</h1><p>Open <b>app.js</b> and replace the two Supabase placeholders, then change the shared password.</p></div></div>`;
    return;
  }
  const {data:{session}}=await supabase.auth.getSession();
  state.session=session;
  if(!session){login();return}
  try {
    await loadProfile(); await loadUsers(); await loadConversations(); render(); subscribe();
  } catch(e) {
    console.error(e); toast("Setup error: check that setup.sql was run.","error");
  }
}

supabase.auth.onAuthStateChange((_event,session)=>{
  state.session=session;
  if(session) boot(); else {state.profile=null;state.currentConversation=null;login();}
});

boot();
