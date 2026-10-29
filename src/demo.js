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
    saveProfile:async fields=>{
      if('is_18_plus_confirmed' in fields) {
        if(fields.is_18_plus_confirmed !== true) {
          throw Error('Age confirmation required: you must be at least 18 years old.');
        }
      }
      const prof = db.profiles.find(x=>x.id===current);
      if(!prof?.is_18_plus_confirmed && fields.is_18_plus_confirmed !== true) {
        throw Error('Age confirmation required: you must be at least 18 years old.');
      }
      if(fields.username && !/^[a-z0-9_]{3,24}$/.test(fields.username)) throw Error('Invalid username.');
      if(fields.display_name !== undefined && (!fields.display_name.trim() || fields.display_name.length > 60)) throw Error('Invalid display name.');
      if(fields.bio !== undefined && fields.bio.length > 150) throw Error('Bio exceeds 150 characters.');
      Object.assign(db.profiles[0],fields);
      persist();
      return db.profiles[0];
    },
    getProfile:async id=>clone().profiles.find(x=>x.id===id),
    getProfiles:async ids=>clone().profiles.filter(p=>ids.includes(p.id)),
    getInvite:async()=>db.token,
    rotateInvite:async()=>{db.token='demo-'+uuid().slice(0,10);persist();return db.token;},
    previewInvite:async token=>token===db.token?db.profiles[0]:null,
    sendRequest:async()=>{throw Error('Demo mode cannot send real invitations. Connect Supabase first.');},
    sendUsernameRequest:async()=>{throw Error('Demo mode cannot send real invitations. Connect Supabase first.');},
    commentAuthor:async commentId=>commentAuthor(commentId),
    sendCommentRequest:async commentId=>{
      const card=commentAuthor(commentId);
      if(card.relationship==='self')throw Error('You cannot add yourself');
      if(card.relationship==='friends')throw Error('Already friends');
      if(card.relationship==='outgoing')return card.request_id;
      if(card.relationship==='incoming')throw Error('A request is already pending');
      if(db.requests.filter(r=>r.sender_id===current&&Date.now()-new Date(r.created_at).getTime()<3600000).length>=30)throw Error('Too many friend requests. Try again later.');
      const id=uuid();db.requests.push({id,sender_id:current,receiver_id:card.id,status:'pending',created_at:new Date().toISOString()});persist();return id;
    },
    friendData:async()=>({
      friends:clone().profiles.filter(p=>db.friends.includes(p.id)),
      incoming:clone().requests.filter(r=>r.receiver_id===current&&r.status==='pending').map(r=>({...r,profile:pendingProfile(r.sender_id)})),
      outgoing:clone().requests.filter(r=>r.sender_id===current&&r.status==='pending').map(r=>({...r,profile:pendingProfile(r.receiver_id)}))
    }),
    requestAction:async(id,action)=>{const r=db.requests.find(x=>x.id===id); if(!r)return; r.status={accept:'accepted',decline:'declined',cancel:'canceled'}[action];if(action==='accept'&&!db.friends.includes(r.sender_id))db.friends.push(r.sender_id);persist();},
    unfriend:async id=>{db.friends=db.friends.filter(x=>x!==id);persist();},
    getFeed:async()=>clone().posts.filter(p=>(p.author_id===current||db.friends.includes(p.author_id))&&Date.now()-new Date(p.published_at).getTime()<48*3600000).sort((a,b)=>b.published_at.localeCompare(a.published_at)).map(withExtras),
    getHistory:async(id)=>clone().posts.filter(p=>p.author_id===id&&(id===current || (db.friends.includes(id)&&Date.now()-new Date(p.published_at).getTime()<30*86400000))).sort((a,b)=>b.published_at.localeCompare(a.published_at)).map(withExtras),
    getPhotos:async post=>post.photos||[],
    imageUrl:async path=>path,
    getDailyPostingStatus:async()=>dailyStatus(),
    createPost:async(kind,reason,files)=>{
      if(!['drank','sober'].includes(kind)||!reason?.trim()||reason.length>300||files.length>3||(kind==='drank'&&files.length===0)) throw Error('Invalid post details.');
      const p={id:uuid(),author_id:current,kind,reason,status:'published',published_at:new Date().toISOString(),photos:[]};
      for(const file of files) p.photos.push({path:await imgData(file)});
      if(dailyStatus().count>=3)throw Object.assign(Error('DAILY_POST_LIMIT'),{code:'P0001'});
      db.posts.unshift(p); try{persist()}catch {db.posts.shift(); throw Error('Demo storage is full. Use fewer/smaller photos or connect Supabase.');}
      return p;
    },
    comment:async(postId,body)=>{if(!body?.trim()||body.length>300||!isOpen(postId))throw Error('Comments are closed or invalid.');db.comments.push({id:uuid(),post_id:postId,author_id:current,author_name:db.profiles[0].display_name,body,created_at:new Date().toISOString()});persist();},
    react:async(postId,emoji)=>{if(!isOpen(postId)||emoji&&!['😂','❤️','😮','🔥','👏'].includes(emoji))throw Error('Reactions are closed or invalid.');db.reactions=db.reactions.filter(r=>!(r.post_id===postId&&r.user_id===current));if(emoji)db.reactions.push({post_id:postId,user_id:current,emoji});persist();},
    saveAvatar:async file=>{db.profiles[0].avatar_path=await imgData(file);persist();return db.profiles[0].avatar_path;},
    resetDemo:async()=>{db=starter();persist();},
    deleteAccount:async()=>{
      db.posts=[];
      db.reactions=[];
      db.comments=[];
      db.friends=[];
      db.requests=[];
      db.profiles[0].avatar_path=null;
      db.profiles[0].is_18_plus_confirmed=false;
      persist();
    }
  };
  function dailyStatus(){
    const stamp=new Date(),end=new Date(stamp);end.setHours(24,0,0,0);
    const day=date=>[date.getFullYear(),date.getMonth(),date.getDate()].join('-');
    return {count:db.posts.filter(p=>p.author_id===current&&p.status==='published'&&day(new Date(p.published_at))===day(stamp)).length,limit:3,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,reset_at:end.toISOString(),server_now:stamp.toISOString()};
  }
  function commentAuthor(commentId){
    const c=db.comments.find(c=>c.id===commentId),p=c&&db.posts.find(p=>p.id===c.post_id);
    if(!db.user||!p||p.status!=='published'||!(p.author_id===current||(db.friends.includes(p.author_id)&&Date.now()-new Date(p.published_at).getTime()<=30*86400000)))throw Error('User unavailable.');
    const target=db.profiles.find(p=>p.id===c.author_id);if(!target)throw Error('User unavailable.');
    const request=db.requests.find(r=>r.status==='pending'&&((r.sender_id===current&&r.receiver_id===target.id)||(r.receiver_id===current&&r.sender_id===target.id)));
    const relationship=target.id===current?'self':db.friends.includes(target.id)?'friends':request?(request.sender_id===current?'outgoing':'incoming'):'none';
    return {id:target.id,display_name:target.display_name,username:target.username,avatar_path:['self','friends'].includes(relationship)?target.avatar_path:null,relationship,request_id:request?.id||null};
  }
  function pendingProfile(id){
    const p=db.profiles.find(p=>p.id===id);if(!p)return undefined;
    return {id:p.id,display_name:p.display_name,username:p.username,avatar_path:db.friends.includes(id)?p.avatar_path:null};
  }
  function isOpen(id) {const p=db.posts.find(x=>x.id===id);return p&&(p.author_id===current||db.friends.includes(p.author_id))&&Date.now()-new Date(p.published_at).getTime()<48*3600000;}
  function withExtras(p) {
    return {...p,post_photos:p.photos||[],comments:clone().comments.filter(c=>c.post_id===p.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)),reactions:clone().reactions.filter(r=>r.post_id===p.id)};
  }
}
