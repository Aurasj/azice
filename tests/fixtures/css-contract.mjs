// Test-only ordered CSS inventory. Preserve selector/value text and duplicates;
// ignore only comments and surrounding formatting whitespace. No dependencies.
export function orderedCSS(source){
 let index=0;
 function segment(stops){
  let text='',quote='',depth=0;
  while(index<source.length){
   const char=source[index];
   if(quote){text+=char;index++;if(char==='\\'&&index<source.length)text+=source[index++];else if(char===quote)quote='';continue;}
   if(char==='"'||char==="'"){quote=char;text+=char;index++;continue;}
   if(source.startsWith('/*',index)){
    const end=source.indexOf('*/',index+2);if(end<0)throw Error('Unclosed CSS comment');index=end+2;text+=' ';continue;
   }
   if(char==='('||char==='[')depth++;
   if(char===')'||char===']')depth--;
   if(depth<0)throw Error('Unbalanced CSS grouping');
   if(!depth&&stops.includes(char)){index++;return {text:text.trim(),stop:char};}
   text+=char;index++;
  }
  if(quote||depth)throw Error('Unclosed CSS string/group');
  return {text:text.trim(),stop:''};
 }
 function rules(nested=false){
  const result=[];
  while(index<source.length){
   const head=segment(['{','}']);
   if(head.stop==='}'){
    if(!nested||head.text)throw Error('Unexpected CSS closing brace');return result;
   }
   if(!head.stop){if(head.text||nested)throw Error('Incomplete CSS rule');return result;}
   if(!head.text)throw Error('Missing CSS prelude');
   if(head.text.startsWith('@')){
    if(!head.text.startsWith('@media'))throw Error('Add explicit coverage for this CSS at-rule');
    result.push({prelude:head.text,rules:rules(true)});continue;
   }
   const declarations=[];let closed=false;
   while(index<source.length){
    const item=segment([';','}','{']);
    if(item.stop==='{')throw Error('Nested style rules need explicit coverage');
    if(item.text){
     const colon=item.text.indexOf(':');if(colon<1)throw Error('Invalid CSS declaration');
     declarations.push([item.text.slice(0,colon).trim(),item.text.slice(colon+1).trim()]);
    }
    if(item.stop==='}'){closed=true;break;}
    if(!item.stop)break;
   }
   if(!closed)throw Error('Unclosed CSS rule');
   result.push({prelude:head.text,declarations});
  }
  if(nested)throw Error('Unclosed CSS group');return result;
 }
 return rules();
}

// Compatibility for existing property assertions; never remove whitespace from
// selector tokens or string/function values, where it may change CSS meaning.
export function compactCSS(source){
 const render=rules=>rules.map(rule=>rule.prelude+'{'+(rule.rules?render(rule.rules):rule.declarations.map(([name,value])=>name+':'+value).join(';'))+'}').join('');
 return render(orderedCSS(source));
}
