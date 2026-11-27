export function directoryRole(tab, actorRole) {
  return tab === 'distributors' && [0, 1].includes(Number(actorRole)) ? 10 : 3;
}
export function directoryFilters(role, search, status, extra = {}) {
  return {...extra, role, search,
    ...(status === 'pending' ? {approved:[false,null],disabled:false} :
      status === 'onboarding' ? {approved:[true],onboarded:false,disabled:false} :
      status === 'approved' ? {approved:[true],disabled:false} :
      status === 'active' ? {approved:[true],onboarded:true,disabled:false} :
      status === 'disabled' ? {disabled:true} : {})};
}
export function commercialPath(person) {
  return `/squad/${Number(person.role) === 10 ? 'distributors' : 'customers'}/${encodeURIComponent(person.id)}`;
}
export function readDirectoryState(params) {
  let filters={},cursors=[null];
  try {const value=JSON.parse(params.get('filters'));if(value&&typeof value==='object'&&!Array.isArray(value))filters=value;}catch{}
  try {const value=JSON.parse(params.get('pages'));if(Array.isArray(value)&&value.length>0&&value.length<=100&&value[0]===null&&value.slice(1).every(v=>typeof v==='string'&&v.length<=4096))cursors=value;}catch{}
  return {filters,cursors};
}
