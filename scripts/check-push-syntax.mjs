// Optional syntax transpilation using an ignored temporary TypeScript compiler.
import ts from '../supabase/.temp/push-tests/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs';
const files=['supabase/functions/push-subscriptions/index.ts','supabase/functions/push-dispatch/index.ts'];
for(const file of files){
 const source=fs.readFileSync(file,'utf8'),result=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
 const errors=result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)||[];
 if(errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
 console.log('TypeScript syntax passed: '+file);
}
console.log('Syntax transpilation only; Deno/npm resolution and native Edge runtime require deployment-environment validation.');
