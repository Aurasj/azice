// Shared, dependency-free validation and privacy policy; also exercised by Node tests.
export const categories=['friend_requests','new_posts','comments','reactions','posting_reminders'];
export function validEndpoint(endpoint){
 try{
  const u=new URL(endpoint);
  return endpoint.length<=2048&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.pathname!=='/'&&(
   u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||
   /^[a-z0-9-]+\.push\.apple\.com$/.test(u.hostname)||/^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname));
 }catch{return false;}
}
const decode=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]+={0,2}$/.test(value))throw Error('Invalid key');return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));};
export function validSubscription(value,binding){
 try{const key=decode(value?.keys?.p256dh);return validEndpoint(value.endpoint)&&key.length===65&&key[0]===4&&decode(value.keys.auth).length===16&&/^[a-f0-9]{64}$/.test(binding);}catch{return false;}
}
export function payload(batch,binding){
 if(!categories.includes(batch.category)||!validId(batch.id)||!/^[a-f0-9]{64}$/.test(binding))throw Error('Invalid job');
 return {id:batch.id,category:batch.category,binding}; // Never names, posts, reasons, photos or comments.
}
export const validId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function deliveryResult(status){
 if(status>=200&&status<300)return 'sent';
 if(status===404||status===410)return 'expired';
 if(status===429||status>=500)return 'retry';
 return 'permanent';
}
