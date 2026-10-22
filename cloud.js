/* Browser-side Supabase adapter. All private access must ALSO be enforced by database RLS. */
export function createCloud(client) {
  const run = async q => { const {data,error}=await q; if(error) throw error; return data; };
  const me = async()=>{const {data:{user},error}=await client.auth.getUser(); if(error) throw error;return user;};
  const profileMap = async ids => {
    if (!ids.length) return [];
    return run(client.from('profiles').select('id,display_name,username,bio,avatar_path').in('id',Array.from(new Set(ids))));
  };
  const decorate = async posts => {
    if(!posts.length)return [];
    const prof=await profileMap(posts.map(p=>p.author_id));
    const names=new Map(prof.map(p=>[p.id,p]));
    return posts.map(p=>({...p,author:names.get(p.author_id)||{display_name:'Former friend',username:'unknown'},post_photos:(p.post_photos||[]).sort((a,b)=>a.slot-b.slot),comments:(p.comments||[]).sort((a,b)=>a.created_at.localeCompare(b.created_at)),reactions:p.reactions||[]}));
  };
  const postQuery = () => client.from('posts').select('id,author_id,kind,reason,published_at,post_photos(slot,path),comments(id,post_id,author_id,author_name,body,created_at),reactions(post_id,user_id,emoji)').eq('status','published');
  return {
    mode:'cloud', getUser:me,
    signIn:async(email,password)=>{const data=await run(client.auth.signInWithPassword({email,password}));return data.user;},
    signUp:async(email,password)=>{const data=await run(client.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}}));return data.session ? data.user : null;},
    google:async()=>{const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin}});if(error)throw error;},
    signOut:async()=>{const {error}=await client.auth.signOut();if(error)throw error;},
    getMyProfile:async()=>{const u=await me();return u?run(client.from('profiles').select('*').eq('id',u.id).maybeSingle()):null;},
    saveProfile:async fields=>{const u=await me();return run(client.from('profiles').upsert({id:u.id,...fields},{onConflict:'id'}).select('*').single());},
    getProfile:async id=>run(client.from('profiles').select('id,display_name,username,bio,avatar_path').eq('id',id).maybeSingle()),
    getProfiles:profileMap,
    getInvite:async()=>{const u=await me();const row=await run(client.from('invites').select('token').eq('user_id',u.id).maybeSingle());return row?.token || (await run(client.rpc('rotate_invite')));},
    rotateInvite:async()=>run(client.rpc('rotate_invite')),
    previewInvite:async token=>{const rows=await run(client.rpc('preview_invite',{p_token:token}));return rows?.[0]||null;},
    sendRequest:async token=>run(client.rpc('send_friend_request',{p_token:token})),
    friendData:async()=>{
      const u=await me();
      const [edges, requests] = await Promise.all([
        run(client.from('friendships').select('user_a,user_b').or(`user_a.eq.${u.id},user_b.eq.${u.id}`)),
        run(client.from('friend_requests').select('id,sender_id,receiver_id,status,created_at').eq('status','pending').or(`sender_id.eq.${u.id},receiver_id.eq.${u.id}`))
      ]);
      const friendIds=edges.map(r=>r.user_a===u.id?r.user_b:r.user_a);
      const ids=[...friendIds,...requests.map(r=>r.sender_id===u.id?r.receiver_id:r.sender_id)];
      const profiles=await profileMap(ids);
      const get=id=>profiles.find(p=>p.id===id)||{id,display_name:'Unknown',username:'unknown'};
      return {friends:friendIds.map(get),incoming:requests.filter(r=>r.receiver_id===u.id).map(r=>({...r,profile:get(r.sender_id)})),outgoing:requests.filter(r=>r.sender_id===u.id).map(r=>({...r,profile:get(r.receiver_id)}))};
    },
    requestAction:async(id,action)=>run(client.rpc('handle_friend_request',{p_request_id:id,p_action:action})),
    unfriend:async id=>run(client.rpc('remove_friend',{p_friend_id:id})),
    getFeed:async()=>decorate(await run(postQuery().gte('published_at',new Date(Date.now()-48*3600000).toISOString()).order('published_at',{ascending:false}).limit(100))),
    getHistory:async id=>decorate(await run(postQuery().eq('author_id',id).order('published_at',{ascending:false}).limit(250))),
    imageUrl:async path=>{
      if(path?.startsWith('data:'))return path;
      const bucket=path?.startsWith('avatar:')?'avatars':'post-images';
      const clean=path?.startsWith('avatar:')?path.slice(7):path;
      const {data,error}=await client.storage.from(bucket).download(clean);
      if(error) throw error;
      return URL.createObjectURL(data);
    },
    createPost:async(kind,reason,files)=>{
      const u=await me();
      const draft=await run(client.from('posts').insert({author_id:u.id,kind,reason,status:'draft'}).select('id').single());
      for(let i=0;i<files.length;i++) {
        const path=`${u.id}/${draft.id}/${i+1}-${crypto.randomUUID()}.jpg`;
        const {error}=await client.storage.from('post-images').upload(path,files[i],{contentType:'image/jpeg',upsert:false});
        if(error)throw error;
        await run(client.from('post_photos').insert({post_id:draft.id,slot:i+1,path}));
      }
      await run(client.rpc('publish_post',{p_post_id:draft.id}));
      return draft;
    },
    comment:async(postId,body)=>{const u=await me();return run(client.from('comments').insert({post_id:postId,author_id:u.id,body}));},
    react:async(postId,emoji)=>{
      const u=await me();
      if(!emoji)return run(client.from('reactions').delete().eq('post_id',postId).eq('user_id',u.id));
      return run(client.from('reactions').upsert({post_id:postId,user_id:u.id,emoji},{onConflict:'post_id,user_id'}));
    },
    saveAvatar:async file=>{
      const u=await me();const path=`${u.id}/${crypto.randomUUID()}.jpg`;
      const {error}=await client.storage.from('avatars').upload(path,file,{contentType:'image/jpeg',upsert:false});
      if(error)throw error;
      await run(client.from('profiles').update({avatar_path:path}).eq('id',u.id));
      return `avatar:${path}`;
    }
  };
}
