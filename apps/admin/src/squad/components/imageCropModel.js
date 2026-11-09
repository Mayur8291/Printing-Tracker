const PIXELS=40_000_000,EDGE=4096;
export async function prepareCropCanvas(file,turns=0){
 if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file?.type)||file.size>10*1024*1024)throw new Error('Choose a PNG, JPEG, WebP or GIF image up to 10 MB.');
 // Browser decoding applies EXIF orientation before the user's quarter-turns.
 const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
 try{
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>PIXELS)throw new Error('This image is too large to crop safely (40 megapixels maximum).');
  const quarter=((turns%4)+4)%4,scale=Math.min(1,EDGE/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas');canvas.width=quarter%2?h:w;canvas.height=quarter%2?w:h;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('This browser cannot crop images.');
  ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(quarter*Math.PI/2);ctx.drawImage(bitmap,-w/2,-h/2,w,h);return canvas;
 }finally{bitmap.close();}
}
export function cropBounds(rect){
 const {x,y,width,height}=rect;if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>100.001||y+height>100.001)throw new Error('Keep the crop inside the image and choose a non-empty area.');return rect;
}
export async function cropImageFile(canvas,rect,filename){
 cropBounds(rect);const x=Math.round(canvas.width*rect.x/100),y=Math.round(canvas.height*rect.y/100),width=Math.min(canvas.width-x,Math.max(1,Math.round(canvas.width*rect.width/100))),height=Math.min(canvas.height-y,Math.max(1,Math.round(canvas.height*rect.height/100)));
 const output=document.createElement('canvas');output.width=width;output.height=height;const context=output.getContext('2d');if(!context)throw new Error('This browser cannot crop images.');context.drawImage(canvas,x,y,width,height,0,0,width,height);
 const blob=await new Promise((resolve,reject)=>output.toBlob(value=>value?resolve(value):reject(new Error('The cropped image could not be created.')),'image/png'));
 if(blob.size>10*1024*1024)throw new Error('The cropped PNG exceeds 10 MB. Choose a smaller area.');
 return new File([blob],`${(filename||'image').replace(/\.[^.]+$/,'').slice(0,160)}-cropped.png`,{type:'image/png'});
}
