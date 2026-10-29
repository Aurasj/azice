// Stateless presentation only: no application state, DOM access or side effects.
export function activityBellIcon(){return '<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';}
export const html = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt = date => new Date(date).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
export const dayISO = value => {const d=new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function brand(){return `<div class="brand">AziCe<span>?</span></div>`;}
export function initials(name){return html((name||'?').trim().slice(0,1).toUpperCase());}
export function backBar(title, action='profile'){return `<div class="subheader"><button class="icon-btn" data-action="${action}" aria-label="Back">‹</button><h1>${html(title)}</h1></div>`;}
export function photoCard(photo,idx){const path=html(photo.path);return `<button type="button" class="photo-slide" data-action="view-photo" data-path="${path}" aria-label="Open full photo ${idx+1}"><span class="photo-loading" aria-hidden="true">📷</span><img data-private-photo="${path}" alt="Photo ${idx+1}" loading="lazy"></button>`;}
export function avatar(p,cls=''){const path=p?.avatar_path;const src=path?(path.startsWith('data:')?path:(path.startsWith('avatar:')?path:`avatar:${path}`)):null;return `<div class="avatar ${cls}">${src?`<img data-private-photo="${html(src)}" alt="${html(p?.display_name||'User')} avatar">`:initials(p?.display_name)}</div>`;}
