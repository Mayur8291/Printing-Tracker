/** Optional People→Orders context; invalid links must not silently become all orders. */
export function orderContext(search=''){
 const params=new URLSearchParams(search),keys=['customer_id','manager_id','coordinator_id','worker_id'];
 const present=keys.filter(key=>params.has(key));
 if(!present.length)return {filters:{},title:'Orders',id:null};
 if(present.length!==1||params.getAll(present[0]).length!==1)return {error:'Choose one person to view their orders.'};
 const key=present[0],id=params.get(key);
 if(!/^[1-9]\d{0,18}$/.test(id)||BigInt(id)>9223372036854775807n)return {error:'This person link is invalid. Return to People and open their orders again.'};
 return {filters:{[key]:id},title:({customer_id:'Customer orders',manager_id:'Factory manager orders',coordinator_id:'Coordinator orders',worker_id:'Job worker orders'})[key],id,key};
}
