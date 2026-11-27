import {parseBannerDestination} from '@canto/shared/squad';
export function safePromotionLink(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&['youtube.com','www.youtube.com','youtu.be','drive.google.com','docs.google.com','vimeo.com','www.vimeo.com'].includes(url.hostname)?url.href:null;}catch{return null;}
}
export function bannerDestination(destination){
  const parsed=parseBannerDestination(destination);if(!parsed)return null;
  const params=new URLSearchParams({type:'ready-made'});
  for(const [key,value] of [['brand_id',parsed.brandId],['category_id',parsed.categoryId],['class_id',parsed.classId]])if(value!=null)params.set(key,value);
  return `/squad/catalogue?${params}`;
}
