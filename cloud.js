/* Browser-side Supabase adapter. All private access must ALSO be enforced by database RLS. */
export const isSessionMissingOrInvalid = err => {
  if (!err) return false;
  if (err.name === 'AuthSessionMissingError') return true;
  if (typeof err.message === 'string' && /auth session missing/i.test(err.message)) return true;

  const missingCodes = ['refresh_token_not_found', 'invalid_grant', 'invalid_token', 'user_not_found', 'session_not_found'];
  if (err.code && missingCodes.includes(err.code)) return true;

  // Real connection, network, or server failures must not be treated as missing sessions
  if (err.name === 'AuthRetryableFetchError' || err.name === 'TypeError') return false;
  if (typeof err.message === 'string' && /failed to fetch|network|load failed/i.test(err.message)) return false;
  if (typeof err.status === 'number' && err.status >= 500) return false;

  // API key configuration errors must remain visible
  if (typeof err.message === 'string' && /api\s*key|apikey/i.test(err.message)) return false;

  if (err.status === 400 || err.status === 401) {
    const msg = String(err.message || '').toLowerCase();
    if (
      msg.includes('refresh token') ||
      msg.includes('jwt') ||
      msg.includes('token is expired') ||
      msg.includes('token expired') ||
      msg.includes('invalid claim') ||
      msg.includes('session expired') ||
      msg.includes('session not found') ||
      msg.includes('user not found') ||
      err.name === 'AuthApiError'
    ) {
      return true;
    }
  }

  return false;
};

// PKCE verifier must survive an email opening a new tab; recovery sessions stay
// tab-local and separate from the ordinary application's session/storage key.
export function createRecoveryStorage(shared,tab){return {
  getItem:key=>(key.endsWith('-code-verifier')?shared:tab).getItem(key),
  setItem:(key,value)=>(key.endsWith('-code-verifier')?shared:tab).setItem(key,value),
  removeItem:key=>(key.endsWith('-code-verifier')?shared:tab).removeItem(key)
};}
export function createCloud(client,{recoveryClient=null,origin=null,postCleanupStorage=null}={}) {
  const run = async q => { const {data,error}=await q; if(error) throw error; return data; };
  // Journal contains only owned draft IDs/paths, never images or tokens.
  // Server-side draft/photo rows remain the durable recovery manifest as well.
  const memoryJournal=new Map(),postOperations=new Set();
  let postAccount=null,postAccountVersion=0;
  client.auth?.onAuthStateChange?.((_event,session)=>{
    const id=session?.user?.id||null;if(id!==postAccount){postAccount=id;postAccountVersion++;}
  });
  const journal=()=>postCleanupStorage||(typeof window==='undefined'?{
    getItem:key=>memoryJournal.get(key)||null,setItem:(key,value)=>memoryJournal.set(key,value)
  }:(globalThis.navigator?.locks?.request?globalThis.localStorage:globalThis.sessionStorage));
  const journalKey=user=>'azice_post_cleanup_v1:'+user;
  const readAttempts=user=>{
    const rows=JSON.parse(journal().getItem(journalKey(user))||'[]');
    if(!Array.isArray(rows)||rows.some(row=>!row?.id||!Array.isArray(row.paths)||row.paths.length>3||row.paths.some(path=>!path.startsWith(`${user}/${row.id}/`))))throw Error('Post recovery information is invalid. Please contact support.');
    return rows;
  };
  const remember=(user,attempt,remove=false)=>{
    const rows=readAttempts(user).filter(row=>row.id!==attempt.id);if(!remove)rows.push(attempt);
    journal().setItem(journalKey(user),JSON.stringify(rows));
  };
  const pendingCleanup=cause=>Object.assign(Error('Photo cleanup is pending. Reopen New Post to retry before publishing again.'),{cleanupPending:true,cause});
  const samePostAccount=async(user,version)=>{
    const current=await me();
    if(current.id!==user||version!==postAccountVersion)throw Error('Account changed. Please try again.');
  };
  const withPostOperation=async task=>{
    const user=(await me()).id;
    if(postOperations.has(user))throw Error('A post operation is already in progress.');
    if(postAccount!==user){postAccount=user;postAccountVersion++;}
    const version=postAccountVersion;postOperations.add(user);
    try{
      // Shared durable journals need cross-tab exclusion. Older browsers use
      // per-tab persistence instead, so another tab cannot sweep a live upload.
      if(globalThis.navigator?.locks?.request)return await globalThis.navigator.locks.request(
        'azice:post-operation:'+user,{ifAvailable:true},lock=>{
          if(!lock)throw Error('A post operation is already in progress in another tab.');
          return task(user,version);
        });
      return await task(user,version);
    }finally{postOperations.delete(user);}
  };
  const cleanAttempts=async(user,version,resumePublish=false)=>{
    const published=[],retained=[];
    for(const attempt of readAttempts(user)){
      try{
        await samePostAccount(user,version);
        let post=await run(client.from('posts').select('id,status,post_photos(path)').eq('id',attempt.id).eq('author_id',user).maybeSingle());
        await samePostAccount(user,version);
        if(!post){
          if(!attempt.paths.length||attempt.phase==='deleting'){remember(user,attempt,true);continue;}
          throw Error('Draft unavailable; recovery information retained.');
        }
        if(post.status==='published'){published.push({id:attempt.id});remember(user,attempt,true);continue;}
        if(post.status!=='draft')throw Error('Unexpected post state.');
        if(attempt.phase==='publishing'){
          if(!resumePublish)throw Error('Previous publication is unconfirmed. Retry Publish to resolve it.');
          await samePostAccount(user,version);
          const {error}=await client.rpc('publish_post',{p_post_id:attempt.id});
          await samePostAccount(user,version);
          post=await run(client.from('posts').select('id,status,post_photos(path)').eq('id',attempt.id).eq('author_id',user).maybeSingle());
          await samePostAccount(user,version);
          if(post?.status==='published'){published.push({id:attempt.id});remember(user,attempt,true);continue;}
          if(error&&/^[0-9A-Z]{5}$/.test(error.code||'')){attempt.phase='cleanup';remember(user,attempt);}
          else throw error||Error('Publication is still unconfirmed.');
        }
        // An interrupted/ambiguous upload may finish server-side after the
        // connection ends. Keep its draft+metadata even after files disappear.
        if(!Array.isArray(post.post_photos)||attempt.paths.some(path=>!post.post_photos.some(photo=>photo.path===path)))throw Error('Photo cleanup visibility could not be verified.');
        // Recover reservations even if the journal write failed before upload.
        attempt.paths=post.post_photos.map(photo=>photo.path);
        if(attempt.phase==='uploading')attempt.retainDraft=true;
        attempt.phase='cleanup';remember(user,attempt);
        const prefix=`${user}/${attempt.id}`;
        if(attempt.paths.length){
          await samePostAccount(user,version);
          const files=await run(client.storage.from('post-images').list(prefix,{limit:100}));
          if(!Array.isArray(files))throw Error('Could not verify uploaded files.');
          const paths=files.map(file=>prefix+'/'+file.name);
          if(paths.some(path=>!attempt.paths.includes(path)))throw Error('Unexpected draft files; recovery information retained.');
          if(paths.length){await samePostAccount(user,version);await run(client.storage.from('post-images').remove(paths));}
          await samePostAccount(user,version);
          const remaining=await run(client.storage.from('post-images').list(prefix,{limit:100}));
          if(!Array.isArray(remaining)||remaining.length)throw Error('Uploaded files remain.');
        }
        if(attempt.retainDraft){retained.push(attempt.id);continue;}
        await samePostAccount(user,version);attempt.phase='deleting';remember(user,attempt);
        const deleted=await run(client.from('posts').delete().eq('id',attempt.id).eq('author_id',user).eq('status','draft').select('id'));
        if(!Array.isArray(deleted)||!deleted.some(row=>row.id===attempt.id))throw Error('Draft deletion was not confirmed.');
        remember(user,attempt,true);
      }catch(error){throw pendingCleanup(error);}
    }
    return {published,retained};
  };
  const commentRpc = async (name,commentId) => {
    try { return await run(client.rpc(name,{p_comment_id:commentId})); }
    catch(error) {
      const safe=['Too many friend requests. Try again later.','A request is already pending','Already friends','You cannot add yourself'];
      throw Error(safe.includes(error.message)?error.message:'User unavailable.');
    }
  };
  const getUser = async () => {
    try {
      const { data, error } = await client.auth.getUser();
      if (error) {
        if (isSessionMissingOrInvalid(error)) {
          await client.auth.signOut().catch(() => {});
          return null;
        }
        throw error;
      }
      return data?.user || null;
    } catch (err) {
      if (isSessionMissingOrInvalid(err)) {
        await client.auth.signOut().catch(() => {});
        return null;
      }
      throw err;
    }
  };
  const me = async () => {
    const u = await getUser();
    if (!u) throw new Error('Authentication required');
    return u;
  };
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
  const recoveryAuth=()=>{if(!recoveryClient)throw Error('Password recovery is unavailable.');return recoveryClient.auth;};
  const verifiedRecovery=async expected=>{const {data,error}=await recoveryAuth().getUser();if(error||!data?.user||expected&&data.user.id!==expected)throw Object.assign(Error('Recovery link is invalid or expired.'),{code:'recovery_invalid'});return data.user;};
  return {
    mode:'cloud', getUser,
    onAuthChange:callback=>client.auth.onAuthStateChange((event,session)=>callback(session?.user||null,event)).data.subscription,
    requestPasswordReset:async email=>{
      const redirectTo=new URL('/?recovery=1',origin||window.location.origin).href;
      const {error}=await recoveryAuth().resetPasswordForEmail(email,{redirectTo});if(error)throw error;
    },
    beginPasswordRecovery:async link=>{
      const auth=recoveryAuth();
      if(link.kind==='resume'){if(!link.userId)throw Object.assign(Error('Recovery link is invalid or expired.'),{code:'recovery_invalid'});return verifiedRecovery(link.userId);}
      // Do not sign out here: Auth sign-out also clears the PKCE code verifier.
      // A successful exchange replaces only this tab's isolated recovery session.
      let result;
      if(link.kind==='implicit')result=await auth.setSession({access_token:link.accessToken,refresh_token:link.refreshToken});
      else if(link.kind==='pkce')result=await auth.exchangeCodeForSession(link.code);
      else if(link.kind==='token_hash')result=await auth.verifyOtp({token_hash:link.tokenHash,type:'recovery'});
      else throw Object.assign(Error('Recovery link is invalid or expired.'),{code:'recovery_invalid'});
      if(result.error)throw result.error;
      const target=result.data?.user?.id||result.data?.session?.user?.id;
      if(!target)throw Object.assign(Error('Recovery link is invalid or expired.'),{code:'recovery_invalid'});
      return {id:target};
    },
    updateRecoveredPassword:async(password,userId)=>{
      if(!userId)throw Object.assign(Error('Recovery link is invalid or expired.'),{code:'recovery_invalid'});
      await verifiedRecovery(userId);
      const {data,error}=await recoveryAuth().updateUser({password});if(error)throw error;
      if(data?.user?.id!==userId)throw Object.assign(Error('Recovery session changed.'),{code:'recovery_invalid'});
    },
    endPasswordRecovery:async()=>{await recoveryAuth().signOut({scope:'local'}).catch(()=>{});},
    signIn:async(email,password)=>{const data=await run(client.auth.signInWithPassword({email,password}));return data.user;},
    signUp:async(email,password)=>{const data=await run(client.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}}));return data.session ? data.user : null;},
    google:async()=>{const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin}});if(error)throw error;},
    signOut:async()=>{const {error}=await client.auth.signOut();if(error)throw error;},
    deleteAccount:async()=>{
      // The Supabase Edge Function 'delete-account' is the sole supported account deletion mechanism.
      // It validates caller JWT, securely removes all owned Storage files via the official Storage API,
      // and only then deletes the Auth user identity via Supabase Admin Auth API.
      const {data,error}=await client.functions.invoke('delete-account');
      if(error) throw error;
      if(data?.error) throw new Error(data.error);
      await client.auth.signOut().catch(()=>{});
      return data;
    },
    getMyProfile:async()=>{const u=await getUser();return u?run(client.from('profiles').select('*').eq('id',u.id).maybeSingle()):null;},
    saveProfile:async(fields,expectedUserId=null)=>{
      const u=await me();
      if(expectedUserId&&u.id!==expectedUserId)throw Error('Account changed. Please try again.');
      // If fields contains is_18_plus_confirmed, it is onboarding insert
      if('is_18_plus_confirmed' in fields) {
        return run(client.from('profiles').insert({id:u.id,...fields}).select('*').single());
      }
      // Otherwise it is an edit to existing profile (display_name, username, bio)
      return run(client.from('profiles').update(fields).eq('id',u.id).select('*').single());
    },
    getProfile:async id=>run(client.from('profiles').select('id,display_name,username,bio,avatar_path').eq('id',id).maybeSingle()),
    getNotificationPreferences:async()=>{const u=await me();return run(client.from('notification_preferences').select('*').eq('user_id',u.id).maybeSingle());},
    getDailyPostingStatus:async()=>run(client.rpc('get_daily_posting_status',{p_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})),
    saveNotificationPreferences:async preferences=>{const data=await run(client.rpc('save_notification_preferences',{p_preferences:preferences}));return Array.isArray(data)?data[0]:data;},
    pushSubscription:async body=>{let timer;try{const {error}=await Promise.race([client.functions.invoke('push-subscriptions',{body}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Could not update notifications. Please try again.')),8000);})]);if(error)throw Error('Could not update notifications. Please try again.');}finally{clearTimeout(timer);}},
    resolveNotification:async id=>run(client.rpc('resolve_notification',{p_id:id})),
    getPost:async id=>(await decorate(await run(postQuery().eq('id',id).limit(1))))[0]||null,
    getActivity:async()=>{
      const data=await run(client.rpc('get_activity'));
      const items=data?.items||[],ids=Array.from(new Set(items.map(item=>item.actor_id)));
      const profiles=ids.length?await run(client.from('profiles').select('id,display_name').in('id',ids)):[];
      const names=new Map(profiles.map(profile=>[profile.id,profile]));
      return {...data,items:items.map(item=>({...item,actor:names.get(item.actor_id)||null}))};
    },
    markActivityRead:async eventKey=>run(client.rpc('mark_activity_read',{p_event_key:eventKey})),
    getProfiles:profileMap,
    getInvite:async()=>{const u=await me();const row=await run(client.from('invites').select('token').eq('user_id',u.id).maybeSingle());return row?.token || (await run(client.rpc('rotate_invite')));},
    rotateInvite:async()=>run(client.rpc('rotate_invite')),
    previewInvite:async token=>{const rows=await run(client.rpc('preview_invite',{p_token:token}));return rows?.[0]||null;},
    sendRequest:async token=>run(client.rpc('send_friend_request',{p_token:token})),
    sendUsernameRequest:async username=>run(client.rpc('send_username_friend_request',{p_username:username})),
    commentAuthor:async commentId=>{
      const rows=await commentRpc('comment_author_card',commentId);
      if(!rows?.[0])throw Error('User unavailable.');
      return rows[0];
    },
    sendCommentRequest:async commentId=>commentRpc('send_comment_friend_request',commentId),
    friendData:async()=>{
      const u=await me();
      const [edges, requests] = await Promise.all([
        run(client.from('friendships').select('user_a,user_b').or(`user_a.eq.${u.id},user_b.eq.${u.id}`)),
        run(client.from('friend_requests').select('id,sender_id,receiver_id,status,created_at').eq('status','pending').or(`sender_id.eq.${u.id},receiver_id.eq.${u.id}`))
      ]);
      const friendIds=edges.map(r=>r.user_a===u.id?r.user_b:r.user_a);
      // Pending requests never grant direct access to private profile rows.
      const [friends,pending]=await Promise.all([
        profileMap(friendIds),
        requests.length?run(client.rpc('pending_friend_request_profiles')):Promise.resolve([])
      ]);
      const profiles=[...friends,...pending];
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
    retryPostCleanup:()=>withPostOperation((user,version)=>cleanAttempts(user,version)),
    createPost:(kind,reason,files)=>withPostOperation(async(user,version)=>{
      if(files.length>3)throw Error('You can add up to 3 photos.');
      const previous=await cleanAttempts(user,version,true);
      if(previous.published.length)return previous.published[0];
      const attempt={id:crypto.randomUUID(),paths:[],phase:'draft'};
      // Refuse to start if the recovery journal cannot be persisted.
      remember(user,attempt);
      try{
        await samePostAccount(user,version);
        // Keep the existing INSERT-only draft flow (no RETURNING).
        await run(client.from('posts').insert({id:attempt.id,author_id:user,kind,reason,status:'draft'}));
        for(let i=0;i<files.length;i++){
          const path=`${user}/${attempt.id}/${i+1}-${crypto.randomUUID()}.jpg`;
          await samePostAccount(user,version);
          // Reserve SELECT-visible metadata BEFORE any bytes can be uploaded.
          await run(client.from('post_photos').insert({post_id:attempt.id,slot:i+1,path}));
          attempt.paths.push(path);attempt.phase='uploading';remember(user,attempt);
          await samePostAccount(user,version);
          try{
            const {error}=await client.storage.from('post-images').upload(path,files[i],{contentType:'image/jpeg',upsert:false});
            if(error){if(!(error.status>=400&&error.status<500))attempt.retainDraft=true;throw error;}
          }catch(error){if(!(error.status>=400&&error.status<500))attempt.retainDraft=true;throw error;}
          attempt.phase='draft';remember(user,attempt);
        }
        await samePostAccount(user,version);attempt.phase='publishing';remember(user,attempt);
        const {error}=await client.rpc('publish_post',{p_post_id:attempt.id});
        if(error)throw error;
        // A local journal failure after confirmed publish must not invite a
        // second publish: the retained record will reconcile to this same ID.
        remember(user,attempt,true);
        return {id:attempt.id};
      }catch(error){
        if(attempt.phase!=='publishing'||/^[0-9A-Z]{5}$/.test(error.code||''))attempt.phase='cleanup';
        try{
          remember(user,attempt);
          const result=await cleanAttempts(user,version);
          if(result.published.length)return result.published[0];
          if(result.retained.includes(attempt.id))throw pendingCleanup(Error('Upload outcome unconfirmed; draft retained.'));
        }catch(cleanupError){
          throw Object.assign(pendingCleanup(cleanupError),{code:error.code,originalError:error});
        }
        throw error;
      }
    }),
    comment:async(postId,body,expectedUserId=null)=>{const u=await me();if(expectedUserId&&u.id!==expectedUserId)throw Error('Account changed. Please try again.');return run(client.from('comments').insert({post_id:postId,author_id:u.id,body}));},
    react:async(postId,emoji)=>{
      const u=await me();
      if(!emoji)return run(client.from('reactions').delete().eq('post_id',postId).eq('user_id',u.id));
      return run(client.from('reactions').upsert({post_id:postId,user_id:u.id,emoji},{onConflict:'post_id,user_id'}));
    },
    saveAvatar:async(file,expectedUserId=null)=>{
      const u=await me();if(expectedUserId&&u.id!==expectedUserId)throw Error('Account changed. Please try again.');
      const path=`${u.id}/${crypto.randomUUID()}.jpg`;
      const {error}=await client.storage.from('avatars').upload(path,file,{contentType:'image/jpeg',upsert:false});
      if(error)throw error;
      try{await run(client.from('profiles').update({avatar_path:path}).eq('id',u.id));}
      catch(error){try{await client.storage.from('avatars').remove([path]);}catch{}throw error;}
      return `avatar:${path}`;
    }
  };
}
