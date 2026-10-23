// Binding-only IndexedDB state, separate from the public-shell cache. No private media/data cache.
const pushTexts={friend_requests:'You have a new friend request.',new_posts:'Your friends shared new updates.',comments:'There is new activity on your post.',reactions:'Your post has new reactions.',posting_reminders:'Your friends have shared updates. Open AziCe? when you feel like it.'};
function pushBinding(value){return new Promise((resolve,reject)=>{
 const open=indexedDB.open('azice-push',1);
 open.onupgradeneeded=()=>open.result.createObjectStore('state');open.onerror=()=>reject(open.error);
 open.onsuccess=()=>{const db=open.result,tx=db.transaction('state',value===undefined?'readonly':'readwrite'),store=tx.objectStore('state');
  const request=value===undefined?store.get('binding'):store.put(value,'binding');
  tx.oncomplete=()=>{resolve(value===undefined?request.result:value);db.close();};tx.onerror=()=>{reject(tx.error);db.close();};};
});}
self.addEventListener('message',event=>{
 if(event.data?.type!=='azice-push-binding'||!event.source?.url?.startsWith(self.location.origin+'/'))return;
 const value=event.data.binding;
 if(value!==null&&!/^[a-f0-9]{64}$/.test(value))return;
 event.waitUntil(pushBinding(value).then(async()=>{
  for(const notification of await self.registration.getNotifications?.()||[])if(notification.data?.binding!==value)notification.close();
  event.ports[0]?.postMessage({ok:true});
 }));
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let data;try{data=event.data?.json();}catch{return;}
 if(!data||!Object.hasOwn(pushTexts,data.category)||!/^[a-f0-9-]{36}$/.test(data.id)||data.binding!==await pushBinding())return;
 await self.registration.showNotification('AziCe?',{body:pushTexts[data.category],icon:'/assets/azice-pwa-192-v2.png',tag:'azice:'+data.id,renotify:false,
  data:{id:data.id,binding:data.binding}});
})()));
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{
  const data=event.notification.data;if(!data||data.binding!==await pushBinding()||!/^[a-f0-9-]{36}$/.test(data.id))return;
  const url=new URL('/?notification='+encodeURIComponent(data.id),self.location.origin).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const client=windows.find(c=>c.url.startsWith(self.location.origin+'/'));
  if(client){await client.navigate(url);await client.focus();}else await self.clients.openWindow(url);
 })());
});
self.addEventListener('pushsubscriptionchange',event=>event.waitUntil(pushBinding(null)));
