// Browser-only source, compiled to the bundled renderer.txt asset. No remote
// imports, routes, credentials, storage or catalogue requests run in this frame.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {DecalGeometry} from 'three/addons/geometries/DecalGeometry.js';

const boot=window.__SCOTT_STUDIO_BOOT__;delete window.__SCOTT_STUDIO_BOOT__;
const frameId=boot.frameId,registry=boot.registry;
const groups=new Set(registry.groups),materials=new Set(registry.materials);
let revision=0,model=null,latest=null,active=true,lost=false,disposed=false,raf=0,dirty=true,artworkGeneration=0,artworkReady=true,omitted=[],readySent=-1,view='front',fitDistance=4.8;
const artworkMeshes=new Map(),textureCache=new Map();
const post=message=>{if(!disposed)window.ReactNativeWebView?.postMessage(JSON.stringify({v:1,frameId,...message}));};
const fail=code=>post({type:'error',revision:Math.max(revision,1),code});
let renderer,scene,camera,controls;
try{
  renderer=new THREE.WebGLRenderer({canvas:document.getElementById('garment'),antialias:true,alpha:false,powerPreference:'default'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setClearColor(0xfaf9f6,1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.82;
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(33,1,.1,30);camera.position.set(.12,.08,4.8);
  controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.enablePan=false;controls.enableDamping=false;controls.rotateSpeed=.6;controls.minPolarAngle=.7;controls.maxPolarAngle=2.3;
  controls.addEventListener('start',()=>{if(revision)post({type:'interaction',revision});});
  controls.addEventListener('change',()=>{dirty=true;schedule();});
  scene.add(new THREE.HemisphereLight(0xffffff,0xc1b5af,.95));
  for(const [color,intensity,position] of [[0xfff8f1,1.6,[-3,5,5]],[0xe6eeff,.35,[4,1,3]],[0xffffff,1.2,[0,2,-4]]]){const light=new THREE.DirectionalLight(color,intensity);light.position.set(...position);scene.add(light);}
}catch{fail('webgl_unavailable');}
function schedule(){if(!renderer||raf||!active||lost||disposed||document.hidden)return;raf=requestAnimationFrame(draw);}
function draw(){raf=0;if(!active||lost||disposed||document.hidden)return;if(dirty){renderer.render(scene,camera);dirty=false;}if(model&&latest&&artworkReady&&readySent!==revision){readySent=revision;post({type:'ready',revision,omittedArtworkIds:omitted});}}
function fit(){if(!renderer)return;const width=Math.max(1,innerWidth),height=Math.max(1,innerHeight);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2,1600/Math.max(width,height)));renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();if(model){const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);fitDistance=Math.max(size.y/(2*tan),size.x/(2*tan*camera.aspect))*1.15;controls.target.copy(bounds.getCenter(new THREE.Vector3()));camera.position.sub(controls.target).normalize().multiplyScalar(fitDistance).add(controls.target);controls.minDistance=Math.max(1.3,fitDistance*.55);controls.maxDistance=Math.max(6.5,fitDistance*1.7);controls.update();}dirty=true;schedule();}
function cameraView(next){view=next;const target=controls.target;camera.position.set(target.x+(next==='back'?-.12:.12),target.y+.08,target.z+(next==='back'?-fitDistance:fitDistance));controls.update();dirty=true;schedule();}
function removeArtwork(){for(const mesh of artworkMeshes.values()){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}artworkMeshes.clear();}
const defaultAnchors={
  front:{position:[0,.15,.275],rotation:[0,0,0],unitsPerInch:.052,maxWidth:.9,maxHeight:1.1},
  leftChest:{position:[.22,.25,.22],rotation:[0,0,0],unitsPerInch:.052,maxWidth:.38,maxHeight:.4},
  rightChest:{position:[-.22,.25,.22],rotation:[0,0,0],unitsPerInch:.052,maxWidth:.38,maxHeight:.4},
  back:{position:[0,.15,-.2],rotation:[0,Math.PI,0],unitsPerInch:.052,maxWidth:.9,maxHeight:1.1},
  leftSleeve:{position:[.7,.28,.16],rotation:[0,0,0],unitsPerInch:.052,maxWidth:.22,maxHeight:.28},
  rightSleeve:{position:[-.7,.28,.16],rotation:[0,0,0],unitsPerInch:.052,maxWidth:.22,maxHeight:.28},
};
function loadTexture(artwork){
  const existing=textureCache.get(artwork.id);if(existing?.uri===artwork.dataUri)return existing.promise;
  existing?.texture?.dispose();
  const entry={uri:artwork.dataUri,texture:null,promise:null};
  entry.promise=new Promise((resolve,reject)=>new THREE.TextureLoader().load(artwork.dataUri,texture=>{
    if(disposed||textureCache.get(artwork.id)!==entry){texture.dispose();reject(Error('stale'));return;}
    const width=texture.image?.width,height=texture.image?.height;if(!width||!height||width>2048||height>2048||width*height>4*1024*1024){texture.dispose();reject(Error('dimensions'));return;}
    texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;entry.texture=texture;resolve(texture);
  },undefined,()=>reject(Error('image'))));textureCache.set(artwork.id,entry);return entry.promise;
}
async function applyArtwork(design){
  const ticket=++artworkGeneration;artworkReady=false;removeArtwork();omitted=[];
  const wanted=new Set((design.artworks||[]).map(artwork=>artwork.id));for(const [id,entry] of textureCache){if(!wanted.has(id)){entry.texture?.dispose();textureCache.delete(id);}}
  const failed=[],occupied=new Set();
  await Promise.all((design.artworks||[]).map(async artwork=>{
    const anchor=registry.artworkAnchors?.[artwork.side]||defaultAnchors[artwork.side];if(!anchor){failed.push(artwork.id);return;}
    // The save contract has no XY coordinates. Two graphics on the same side
    // cannot truthfully be composed by stacking one invisibly over the other.
    if(occupied.has(artwork.side)){failed.push(artwork.id);return;}occupied.add(artwork.side);
    try{const texture=await loadTexture(artwork);if(disposed||ticket!==artworkGeneration)return;
      const width=artwork.widthInches*anchor.unitsPerInch,height=artwork.heightInches*anchor.unitsPerInch;
      // Never silently shrink artwork that does not fit this visual guide.
      if(width>anchor.maxWidth||height>anchor.maxHeight){failed.push(artwork.id);return;}
      model.updateMatrixWorld(true);const orientation=new THREE.Euler(...anchor.rotation),normal=new THREE.Vector3(0,0,1).applyEuler(orientation),point=new THREE.Vector3(...anchor.position);
      const ray=new THREE.Raycaster(point.clone().addScaledVector(normal,2),normal.clone().negate());
      const hit=ray.intersectObject(model,true).find(intersection=>{let node=intersection.object;while(node){if(!node.visible)return false;node=node.parent;}return true;});if(!hit){failed.push(artwork.id);return;}
      const geometry=new DecalGeometry(hit.object,hit.point,orientation,new THREE.Vector3(width,height,.16));if(!geometry.attributes.position.count){geometry.dispose();failed.push(artwork.id);return;}
      const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:texture,transparent:true,roughness:1,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4}));mesh.name=`Artwork_${artwork.id}`;artworkMeshes.set(artwork.id,mesh);scene.add(mesh);
    }catch{if(ticket===artworkGeneration)failed.push(artwork.id);}
  }));
  if(disposed||ticket!==artworkGeneration)return;omitted=failed;artworkReady=true;dirty=true;schedule();
}
function applyDesign(design){
  if(!model)return;const visible=new Set([...design.visibleGroups,...(registry.alwaysVisibleGroups||[])]);
  model.traverse(node=>{if(groups.has(node.name))node.visible=visible.has(node.name);if(node.isMesh)for(const material of Array.isArray(node.material)?node.material:[node.material]){const name=material.userData.studioName;if(materials.has(name))material.color.set(design.materialColors[name]??material.userData.studioDefaultColor);}});
  void applyArtwork(design);dirty=true;schedule();
}
function clear(){artworkGeneration++;latest=null;removeArtwork();for(const entry of textureCache.values())entry.texture?.dispose();textureCache.clear();model?.traverse(node=>{if(groups.has(node.name))node.visible=false;});dirty=true;schedule();}
window.__SCOTT_STUDIO_COMMAND__=message=>{
  if(disposed||!message||message.v!==1||message.frameId!==frameId)return;
  if(message.type==='active'){active=message.active===true;if(!active){cancelAnimationFrame(raf);raf=0;}else{dirty=true;schedule();}return;}
  if(message.type==='clear'){clear();return;}
  if(message.type==='design'){
    if(!Number.isSafeInteger(message.revision)||message.revision<revision||message.design?.modelId!==registry.modelId)return;
    revision=message.revision;latest=message.design;readySent=-1;if(model)applyDesign(latest);return;
  }
  if(message.type==='view'&&['front','back','reset'].includes(message.view)){if(revision)post({type:'interaction',revision});cameraView(message.view==='back'?'back':'front');return;}
  if(message.type==='capture'&&message.revision===revision&&model&&latest&&artworkReady&&!omitted.length&&active&&!lost){
    try{renderer.render(scene,camera);const dataUri=renderer.domElement.toDataURL('image/png');if(dataUri.length>4*1024*1024)throw Error('size');post({type:'capture',revision,requestId:message.requestId,dataUri,width:renderer.domElement.width,height:renderer.domElement.height});}catch{fail('capture_unavailable');}
  }
};
if(renderer){
  const onVisibility=()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else{dirty=true;schedule();}};document.addEventListener('visibilitychange',onVisibility);window.addEventListener('resize',fit);
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;cancelAnimationFrame(raf);raf=0;post({type:'recovering',revision:Math.max(revision,1),code:'context_lost'});});
  renderer.domElement.addEventListener('webglcontextrestored',()=>{lost=false;renderer.setClearColor(0xfaf9f6,1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.82;readySent=-1;dirty=true;schedule();});
  window.addEventListener('pagehide',()=>{disposed=true;artworkGeneration++;cancelAnimationFrame(raf);controls.dispose();removeArtwork();for(const entry of textureCache.values())entry.texture?.dispose();textureCache.clear();scene.traverse(node=>{if(node.isMesh){node.geometry?.dispose();for(const material of Array.isArray(node.material)?node.material:[node.material]){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}}});renderer.dispose();});
  fit();post({type:'boot'});
  try{const binary=atob(boot.modelBase64),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);boot.modelBase64='';
    new GLTFLoader().parse(bytes.buffer,'',gltf=>{if(disposed)return;model=gltf.scene;const foundGroups=new Set(),foundMaterials=new Set();model.traverse(node=>{if(groups.has(node.name))foundGroups.add(node.name);if(node.isMesh){node.material=Array.isArray(node.material)?node.material.map(material=>material.clone()):node.material.clone();for(const material of Array.isArray(node.material)?node.material:[node.material]){const name=material.name.replace(/\.\d+$/,'');material.userData.studioName=name;material.userData.studioDefaultColor=material.color.getHex();foundMaterials.add(name);material.roughness=Math.max(material.roughness??.85,.85);material.metalness=0;}}});
      if([...groups].some(name=>!foundGroups.has(name))||[...materials].some(name=>!foundMaterials.has(name))){fail('asset_contract');return;}
      scene.add(model);fit();cameraView(view);if(latest)applyDesign(latest);else model.traverse(node=>{if(groups.has(node.name))node.visible=false;});
    },()=>fail('asset_parse'));
  }catch{fail('asset_parse');}
}
