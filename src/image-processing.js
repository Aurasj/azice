// Browser-realm image utilities. Callers retain camera, UI and decoded-bitmap ownership.
export async function canvasBlob(source,width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Photo dimensions are invalid.');
 // Draw the entire frame proportionally. A fresh canvas JPEG carries no source EXIF/GPS.
 const canvas=document.createElement('canvas'),factor=Math.min(1,1600/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*factor));canvas.height=Math.max(1,Math.round(height*factor));
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo processing is unavailable.');ctx.drawImage(source,0,0,canvas.width,canvas.height);
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?.type==='image/jpeg'?resolve(b):reject(Error('Could not process photo. Please try again.')),'image/jpeg',.80));
}

export async function decodeAvatar(file){
 try{
  if(typeof createImageBitmap==='function')return await createImageBitmap(file,{imageOrientation:'from-image'});
  const url=URL.createObjectURL(file),image=new Image();
  try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});return image;}finally{URL.revokeObjectURL(url);}
 }catch{throw Error('Could not read this image. Please choose a supported image.');}
}
