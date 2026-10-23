// One pinned server-only dependency handles the RFC 8291 encryption and VAPID signing.
import webpush from 'npm:web-push@3.6.7';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import {deliveryResult,payload,validEndpoint} from '../_shared/push-policy.mjs';

Deno.serve(async(req:Request)=>{
 const secret=Deno.env.get('PUSH_DISPATCH_SECRET');
 if(req.method!=='POST'||!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return new Response('Unauthorized',{status:401});
 if(!Deno.env.get('VAPID_PRIVATE_KEY')||!Deno.env.get('VAPID_PUBLIC_KEY')||!Deno.env.get('VAPID_SUBJECT'))return new Response('Configuration unavailable',{status:503});
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(3000)})}});
 const rpc=async(name:string,args={})=>{const {data,error}=await client.rpc(name,args);if(error)throw Error('Queue operation failed');return data;};
 let processed=0;const outcomes:Record<string,number>={sent:0,expired:0,retry:0,permanent:0,skipped:0};
 try{
  // Bounded run: at most two batches, five devices each, five seconds per relay request.
  for(let n=0;n<2;n++){
   const batch=await rpc('push_claim');if(!batch)break;
   for(const device of batch.devices){
    let result='retry';
    try{
     if(!await rpc('push_validate',{p_batch:batch.id,p_token:batch.token,p_device:device.id}))result='skipped';
     else if(!validEndpoint(device.endpoint))result='permanent';
     else{
      const details=webpush.generateRequestDetails({endpoint:device.endpoint,keys:device.keys},JSON.stringify(payload(batch,device.binding)),{
       TTL:300,urgency:batch.category==='friend_requests'?'high':'normal',topic:batch.id.replaceAll('-',''),
       vapidDetails:{subject:Deno.env.get('VAPID_SUBJECT')!,publicKey:Deno.env.get('VAPID_PUBLIC_KEY')!,privateKey:Deno.env.get('VAPID_PRIVATE_KEY')!}
      });
      const response=await fetch(details.endpoint,{method:'POST',headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(5000)});
      result=deliveryResult(response.status);await response.body?.cancel();
     }
    }catch{/* Network/relay errors retry without logging endpoints or keys. */}
    await rpc('push_complete',{p_batch:batch.id,p_token:batch.token,p_device:device.id,p_result:result});
    outcomes[result]++;
   }
   await rpc('push_release',{p_batch:batch.id,p_token:batch.token});processed++;
  }
  console.info(JSON.stringify({processed,outcomes}));return Response.json({processed,outcomes});
 }catch{return new Response('Notification processing failed',{status:503});}
});
