import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
import * as presentation from '../../src/presentation.js';
// Keep synchronous stateful tests in their own browser realm. Host-Node imports
// cannot be used for helpers that access document/Image/URL. Translate only this
// import-free module's export syntax using the existing test dependency; execute
// its actual implementation once per VM. Native ESM tests cover the real graph.
const imageSource=fs.readFileSync(new URL('../../src/image-processing.js',import.meta.url),'utf8');
const imageCode=ts.transpileModule(imageSource,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.CommonJS}}).outputText;
const imageFactory=new vm.Script('(function(exports){'+imageCode+'\nreturn exports;})',{filename:'src/image-processing.js'});
const images=new WeakMap();
export function runAppInContext(source,context){
 if(!images.has(context))images.set(context,imageFactory.runInContext(context)({}));
 Object.assign(context,presentation,images.get(context));return vm.runInContext(source,context);
}
