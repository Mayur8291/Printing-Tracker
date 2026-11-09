export function safePromotionLink(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&['youtube.com','www.youtube.com','youtu.be','drive.google.com','docs.google.com','vimeo.com','www.vimeo.com'].includes(url.hostname)?url.href:null;}catch{return null;}
}
export function bannerDestination(destination){
  const params=new URLSearchParams({type:'ready-made'});let count=0;
  for(const key of ['brand_id','category_id','class_id']){const value=destination?.[key];if(value!=null){if(!/^[1-9]\d*$/.test(String(value)))return null;params.set(key,String(value));count++;}}
  return count?`/squad/catalogue?${params}`:null;
}
