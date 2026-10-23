import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import {validEndpoint,validSubscription} from '../_shared/push-policy.mjs';

Deno.serve(async(req:Request)=>{
 const origin=Deno.env.get('APP_ORIGIN');
 const headers={'Access-Control-Allow-Origin':origin||'','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Content-Type':'application/json'};
 const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(!origin||req.headers.get('origin')!==origin)return response({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return response({error:'Method not allowed'},405);
 try{
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return response({error:'Authentication required'},401);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:{user},error}=await admin.auth.getUser(token);if(error||!user)return response({error:'Authentication required'},401);
  if(Number(req.headers.get('content-length')||0)>8192)return response({error:'Invalid subscription'},400);
  const text=await req.text();if(text.length>8192)return response({error:'Invalid subscription'},400);
  const body=JSON.parse(text);let result;
  if(body.action==='subscribe'&&validSubscription(body.subscription,body.binding)){
   const raw=Uint8Array.from(atob(body.subscription.keys.p256dh.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   await crypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},false,[]);
   result=await admin.rpc('push_register',{p_user:user.id,p_subscription:body.subscription,p_binding:body.binding});
  }else if(body.action==='unsubscribe'&&validEndpoint(body.endpoint)){
   result=await admin.rpc('push_unregister',{p_user:user.id,p_endpoint:body.endpoint});
  }else return response({error:'Invalid subscription'},400);
  if(result.error)return response({error:'Subscription unavailable. Please retry or disable this device first.'},409);
  return response({ok:true});
 }catch{return response({error:'Could not update notification subscription'},400);}
});
