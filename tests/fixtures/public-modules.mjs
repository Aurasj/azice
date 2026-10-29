// Test infrastructure only: follow browser imports without a bundler or source rewriting.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
export const moduleOrigin='https://azice.test';
export function publicPath(specifier,parent=moduleOrigin+'/index.html'){
  if(!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.startsWith(moduleOrigin+'/'))throw Error('Nonlocal module refused: '+specifier);
  const url=new URL(specifier,parent);
  if(url.origin!==moduleOrigin||url.username||url.password)throw Error('Nonlocal module refused: '+specifier);
  return url;
}
export function sourceFile(root,url){
  const pathname=decodeURIComponent(new URL(url,moduleOrigin).pathname);
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(path.resolve(root)+path.sep))throw Error('Module escapes fixture root');
  return file;
}
export function moduleEntries(html){
  const entries=[];
  const attribute=(tag,name)=>{const match=tag.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));return match&&(match[1]??match[2]??match[3]);};
  for(const tag of html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(attribute(tag[1],'type')!=='module')continue;
    const src=attribute(tag[1],'src');
    if(!src)throw Error('Inline module needs an explicit graph test');
    entries.push(publicPath(new URL(src,moduleOrigin+'/index.html').href).href);
  }
  if(!entries.length)throw Error('No module entry point');
  return entries;
}
export function moduleImports(source,identifier){
  const ast=ts.createSourceFile(identifier,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),imports=[];
  if(ast.parseDiagnostics.length)throw Error('Invalid module syntax: '+identifier);
  function walk(node){
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)imports.push(node.moduleSpecifier.text);
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
      if(node.arguments.length!==1||!ts.isStringLiteralLike(node.arguments[0]))throw Error('Computed import needs an explicit public-module test: '+identifier);
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node,walk);
  }
  walk(ast);return imports.map(specifier=>publicPath(specifier,identifier).href);
}
export function moduleGraph(root=projectRoot,entries=moduleEntries(fs.readFileSync(path.join(root,'index.html'),'utf8'))){
  const graph=new Map();
  function visit(id){
    const url=publicPath(id);
    if(graph.has(url.href))return;
    if(!/\.(?:js|mjs)$/.test(url.pathname))throw Error('Not a JavaScript public module: '+url.pathname);
    const source=fs.readFileSync(sourceFile(root,url.href),'utf8');
    graph.set(url.href,source);
    for(const dependency of moduleImports(source,url.href))visit(dependency);
  }
  entries.forEach(visit);return graph;
}
export const javascriptType=type=>/^(?:text|application)\/javascript(?:\s*;|$)/i.test(type||'');

// Optional real-browser fixture route. Real source/import graph, empty config,
// synthetic demo only. Service-worker registration intentionally fails on this origin.
export function serveModuleFixture(req,res,{root=projectRoot}={}){
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/modules'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end(fs.readFileSync(path.join(root,'index.html'),'utf8'));return true;
  }
  if(pathname==='/config.js'){
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
    res.end('window.AZICE_CONFIG={supabaseUrl:"",supabasePublishableKey:"",pushPublicKey:""};');return true;
  }
  if(pathname==='/sw.js'||pathname==='/push-sw.js'){
    res.writeHead(404,{'Cache-Control':'no-store'});res.end();return true;
  }
  const graph=moduleGraph(root),id=moduleOrigin+pathname;
  if(graph.has(id)){
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
    res.end(graph.get(id));return true;
  }
  if(pathname==='/assets/demo-beer.svg'){
    res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(fs.readFileSync(path.join(root,pathname)));return true;
  }
  return false;
}
