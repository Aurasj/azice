const STORE = 'azice-demo-v1';
const now = Date.now();
const starter = () => ({
  user: { id: 'demo-me', email: 'demo@azice.local' },
  profiles: [
    {id:'demo-me', display_name:'You', username:'yourname', bio:'Every day has a story.', avatar_path:null, is_18_plus_confirmed:true},
    {id:'demo-alex', display_name:'Alex', username:'alex', bio:'Weekend enthusiast.', avatar_path:null},
    {id:'demo-sam', display_name:'Sam', username:'sam', bio:'Tea counts, right?', avatar_path:null}
  ],
  friends: ['demo-alex','demo-sam'],
  requests: [{id:'demo-request',sender_id:'demo-sam',receiver_id:'demo-me',status:'accepted'}],
  posts: [
    {id:'sample-1', author_id:'demo-alex', kind:'drank', reason:"It's my dog's birthday. He insisted. 🐶", status:'published', published_at:new Date(now-35*60*1000).toISOString(), photos:[{path:'/assets/demo-beer.svg'}]},
    {id:'sample-2', author_id:'demo-sam', kind:'sober', reason:"Recovering from a cold. Tea is doing the heavy lifting. ☕", status:'published', published_at:new Date(now-3*3600*1000).toISOString(), photos:[]},
    {id:'sample-3', author_id:'demo-alex', kind:'sober', reason:"Some days water is enough. 💧", status:'published', published_at:new Date(now-5*86400*1000).toISOString(), photos:[]}
  ],
  reactions: [{post_id:'sample-1',user_id:'demo-sam',emoji:'😂'}],
  comments: [{id:'demo-comment',post_id:'sample-1',author_id:'demo-sam',author_name:'Sam',body:'Give the dog a treat too!',created_at:new Date(now-15*60000).toISOString()}],
  token: 'demo-invite',
});
const read = () => {
  try { return JSON.parse(localStorage.getItem(STORE)) || starter(); }
  catch { return starter(); }
};
const save = data => localStorage.setItem(STORE, JSON.stringify(data));
const uuid = () => crypto.randomUUID();
const imgData = async file => new Promise((resolve,reject)=>{
 const fr = new FileReader(); fr.onload=()=>resolve(fr.result); fr.onerror=reject; fr.readAsDataURL(file);
});
export function createDemo() {
  let db = read();
  const current = 'demo-me';
  const clone = () => JSON.parse(JSON.stringify(db));
  const persist = () => save(db);
  return {
    mode:'demo', getUser:async()=>db.user,
    signIn:async()=>db.user, signUp:async()=>db.user, google:async()=>db.user, signOut:async()=>{},
    getMyProfile:async()=>clone().profiles.find(x=>x.id===current),
    saveProfile:async fields=>{Object.assign(db.profiles[0],fields); persist(); return db.profiles[0];},
    getProfile:async id=>clone().profiles.find(x=>x.id===id),
    getProfiles:async ids=>clone().profiles.filter(p=>ids.includes(p.id)),
    getInvite:async()=>db.token,
    rotateInvite:async()=>{db.token='demo-'+uuid().slice(0,10);persist();return db.token;},
    previewInvite:async token=>token===db.token?db.profiles[0]:null,
    sendRequest:async()=>{throw Error('Demo mode cannot send real invitations. Connect Supabase first.');},
    friendData:async()=>({
      friends:clone().profiles.filter(p=>db.friends.includes(p.id)),
      incoming:clone().requests.filter(r=>r.receiver_id===current&&r.status==='pending').map(r=>({...r,profile:db.profiles.find(p=>p.id===r.sender_id)})),
      outgoing:clone().requests.filter(r=>r.sender_id===current&&r.status==='pending').map(r=>({...r,profile:db.profiles.find(p=>p.id===r.receiver_id)}))
    }),
    requestAction:async(id,action)=>{const r=db.requests.find(x=>x.id===id); if(!r)return; r.status={accept:'accepted',decline:'declined',cancel:'canceled'}[action];if(action==='accept'&&!db.friends.includes(r.sender_id))db.friends.push(r.sender_id);persist();},
    unfriend:async id=>{db.friends=db.friends.filter(x=>x!==id);persist();},
    getFeed:async()=>clone().posts.filter(p=>(p.author_id===current||db.friends.includes(p.author_id))&&Date.now()-new Date(p.published_at).getTime()<48*3600000).sort((a,b)=>b.published_at.localeCompare(a.published_at)).map(withExtras),
    getHistory:async(id)=>clone().posts.filter(p=>p.author_id===id&&(id===current || (db.friends.includes(id)&&Date.now()-new Date(p.published_at).getTime()<30*86400000))).sort((a,b)=>b.published_at.localeCompare(a.published_at)).map(withExtras),
    getPhotos:async post=>post.photos||[],
    imageUrl:async path=>path,
    createPost:async(kind,reason,files)=>{
      if(!['drank','sober'].includes(kind)||!reason?.trim()||reason.length>300||files.length>3||(kind==='drank'&&files.length===0)) throw Error('Invalid post details.');
      const p={id:uuid(),author_id:current,kind,reason,status:'published',published_at:new Date().toISOString(),photos:[]};
      for(const file of files) p.photos.push({path:await imgData(file)});
      db.posts.unshift(p); try{persist()}catch {db.posts.shift(); throw Error('Demo storage is full. Use fewer/smaller photos or connect Supabase.');}
      return p;
    },
    comment:async(postId,body)=>{if(!body?.trim()||body.length>300||!isOpen(postId))throw Error('Comments are closed or invalid.');db.comments.push({id:uuid(),post_id:postId,author_id:current,author_name:db.profiles[0].display_name,body,created_at:new Date().toISOString()});persist();},
    react:async(postId,emoji)=>{if(!isOpen(postId)||emoji&&!['😂','❤️','😮','🔥','👏'].includes(emoji))throw Error('Reactions are closed or invalid.');db.reactions=db.reactions.filter(r=>!(r.post_id===postId&&r.user_id===current));if(emoji)db.reactions.push({post_id:postId,user_id:current,emoji});persist();},
    saveAvatar:async file=>{db.profiles[0].avatar_path=await imgData(file);persist();return db.profiles[0].avatar_path;},
    resetDemo:async()=>{db=starter();persist();},
  };
  function isOpen(id) {const p=db.posts.find(x=>x.id===id);return p&&(p.author_id===current||db.friends.includes(p.author_id))&&Date.now()-new Date(p.published_at).getTime()<48*3600000;}
  function withExtras(p) {
    return {...p,post_photos:p.photos||[],comments:clone().comments.filter(c=>c.post_id===p.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)),reactions:clone().reactions.filter(r=>r.post_id===p.id)};
  }
}
