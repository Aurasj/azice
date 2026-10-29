// Documentation-only validation. No network requests, generated output or writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const posix=file=>file.split(path.sep).join('/');
function markdownFiles(root){
  const files=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.md')).map(e=>e.name);
  function walk(folder){if(!fs.existsSync(path.join(root,folder)))return;for(const e of fs.readdirSync(path.join(root,folder),{withFileTypes:true})){if(['.temp','node_modules','dist'].includes(e.name))continue;const file=folder+'/'+e.name;if(e.isDirectory())walk(file);else if(e.isFile()&&file.endsWith('.md'))files.push(file);}}
  for(const folder of ['docs','tests','.github','supabase'])walk(folder);return files.sort();
}
function prose(text){
  let fence=null;
  return text.split(/\r?\n/).map(line=>{
    const marker=line.match(/^\s*(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;return '';}
    return fence?'':line;
  }).join('\n');
}
function anchors(text){
  const found=new Set(),duplicates=new Map();
  for(const line of prose(text).split('\n')){
    const heading=line.match(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    if(heading){const base=heading[1].replace(/<[^>]*>/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu,'').replace(/\s/g,'-');const n=duplicates.get(base)||0;duplicates.set(base,n+1);found.add(base+(n?'-'+n:''));}
    for(const m of line.matchAll(/\bid\s*=\s*['"]([^'"]+)['"]/g))found.add(m[1]);
  }
  return found;
}
function caseExists(root,relative){
  let current=root;for(const part of relative.split('/').filter(Boolean)){
    if(!fs.statSync(current).isDirectory()||!fs.readdirSync(current).includes(part))return false;current=path.join(current,part);
  }return true;
}
export function checkDocumentation(root=process.cwd()){
  root=path.resolve(root);const files=markdownFiles(root),issues=[],graph=new Map(),texts=new Map();let links=0;
  for(const file of files)texts.set(file,fs.readFileSync(path.join(root,file),'utf8'));
  for(const [file,text] of texts){
    const body=prose(text),targets=[];graph.set(file,new Set());
    for(const m of body.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|(?:[^\s()]|\([^)]*\))+)(?:\s+"[^"]*")?\s*\)/g))targets.push(m[1].replace(/^<|>$/g,''));
    for(const m of body.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm))targets.push(m[1].replace(/^<|>$/g,''));
    for(const raw of targets){
      if(/^(?:https?:|mailto:|\/\/)/i.test(raw))continue;
      if(/^[a-z][a-z0-9+.-]*:/i.test(raw)){issues.push(file+': unsupported local-link scheme');continue;}
      links++;let target,fragment;
      try{const at=raw.indexOf('#'),base=at<0?raw:raw.slice(0,at);fragment=at<0?'':decodeURIComponent(raw.slice(at+1));target=base?decodeURIComponent(base.split('?')[0]):path.basename(file);}catch{issues.push(file+': invalid URL encoding');continue;}
      const absolute=path.resolve(root,path.dirname(file),target),relative=posix(path.relative(root,absolute));
      if(relative.startsWith('../')||path.isAbsolute(relative)){issues.push(file+': link escapes repository: '+raw);continue;}
      if(!fs.existsSync(absolute)){issues.push(file+': missing target: '+raw);continue;}
      if(!caseExists(root,relative)){issues.push(file+': filename case mismatch: '+raw);continue;}
      if(texts.has(relative))graph.get(file).add(relative);
      if(fragment&&relative.endsWith('.md')&&!anchors(texts.get(relative)||fs.readFileSync(absolute,'utf8')).has(fragment))issues.push(file+': missing anchor: '+raw);
    }
  }
  return {files,links,issues,graph};
}
export function reachableDocuments(graph,start){
  const seen=new Set();function visit(file){if(seen.has(file))return;seen.add(file);for(const next of graph.get(file)||[])visit(next);}visit(start);return seen;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=checkDocumentation();
  for(const start of ['README.md','docs/README.md']){const reachable=reachableDocuments(result.graph,start);for(const file of result.files.filter(f=>f.startsWith('docs/')))if(!reachable.has(file))result.issues.push(start+': unreachable document: '+file);}
  if(result.issues.length){console.error(result.issues.join('\n'));process.exitCode=1;}
  else console.log(result.files.length+' Markdown files; '+result.links+' local links/anchors and docs reachability passed (no network).');
}
