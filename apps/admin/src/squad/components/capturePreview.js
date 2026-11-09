/** Capture the already authorized, sanitized, decoded garment layers. Only the
 * preview's own blob images may be drawn; this never fetches a legacy URL. */
export async function capturePreview(container,{filename='design-mockup.png',size=1024}={}) {
  const preview=container?.matches?.('.squad-configurator-preview')?container:container?.querySelector('.squad-configurator-preview');
  const frame=preview?.querySelector('[role="img"]');
  if(!frame||frame.getAttribute('aria-busy')==='true'||preview.textContent.includes('This preview is incomplete'))throw new Error('Wait for the complete design preview before capturing it.');
  const layers=[...frame.querySelectorAll('img')];
  if(!layers.length||layers.length>201)throw new Error('A complete design preview is required.');
  if(!Number.isInteger(size)||size<256||size>2048)throw new Error('The preview image size is not supported.');
  const snapshot=layers.map(image=>({image,src:image.src,style:image.getAttribute('style')}));
  for(const {image,src} of snapshot){
    if(!src.startsWith('blob:')||image.hidden)throw new Error('The preview contains unavailable artwork.');
    await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw new Error('The artwork has not finished loading.');
  }
  if(frame.getAttribute('aria-busy')==='true'||snapshot.some(({image,src,style})=>!frame.contains(image)||image.src!==src||image.getAttribute('style')!==style))throw new Error('The design changed during capture. Please try again.');
  const bounds=frame.getBoundingClientRect();
  if(bounds.width<=0||bounds.height<=0)throw new Error('Open the design preview before capturing it.');
  const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
  const context=canvas.getContext('2d');if(!context)throw new Error('This browser could not prepare the design image.');
  context.fillStyle='#ffffff';context.fillRect(0,0,size,size);
  for(const {image} of snapshot){
    const rect=image.getBoundingClientRect(),x=(rect.left-bounds.left)/bounds.width*size,y=(rect.top-bounds.top)/bounds.height*size,width=rect.width/bounds.width*size,height=rect.height/bounds.height*size;
    context.save();
    if(image.style.transform==='scaleX(-1)'){context.translate(x+width,y);context.scale(-1,1);context.drawImage(image,0,0,width,height);}
    else if(!image.style.transform||image.style.transform==='none')context.drawImage(image,x,y,width,height);
    else{context.restore();throw new Error('The preview uses an unsupported image transform.');}
    context.restore();
  }
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('The design image could not be prepared.')),'image/png'));
  if(blob.size>10*1024*1024)throw new Error('The generated mockup exceeds the 10 MB image limit.');
  return new File([blob],filename,{type:'image/png'});
}
