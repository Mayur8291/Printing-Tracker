/** Reserve an Open tab during the user's click, before requesting a fresh grant.
 * Downloads use Storage's attachment response in the current browsing context;
 * creating a new window after the grant resolves is blocked by Safari. */
export function prepareMediaNavigation(asDownload) {
  let tab=null;
  const pendingTab=()=>{try{return tab&&!tab.closed&&tab.location.href==='about:blank';}catch{return false;}};
  const cancel=()=>{if(tab){try{if(pendingTab())tab.close();}catch{/* Only our pending blank tab. */}tab=null;}};
  if(!asDownload){
    tab=window.open('about:blank','_blank');
    if(!tab)throw new Error('The file tab was blocked. Allow pop-ups for this site and try Open again.');
    try {
      tab.opener=null;
      tab.document.title='Preparing file';
      const policy=tab.document.createElement('meta');policy.name='referrer';policy.content='no-referrer';tab.document.head.append(policy);
      tab.document.body.textContent='Preparing file…';
    }catch{cancel();throw new Error('The file tab could not be prepared. Please try again.');}
  }
  return {cancel,complete(url){
    if(asDownload){
      // The reviewed grant endpoint adds this flag to force attachment delivery.
      // Refuse an inline URL rather than navigating away from the application.
      if(!new URL(url).searchParams.has('download'))throw new Error('The download link could not be prepared. Please try again.');
      const anchor=document.createElement('a');anchor.href=url;anchor.target='_self';anchor.rel='noreferrer';anchor.referrerPolicy='no-referrer';
      try{document.body.append(anchor);anchor.click();}finally{anchor.remove();}
    }else{
      if(!pendingTab())throw new Error('The file tab was closed or changed. Please try Open again.');
      tab.location.replace(url);tab=null;
    }
  }};
}
