import {useQueryClient} from '@tanstack/react-query';
import {useSquad,useSquadQuery} from '../../data/hooks';
import {loadConfiguratorOptions} from '../catalogue/addonSelection';
export default function StudioReviewSummary({configuration,baseId,allParts,onEdit}){
 const {scope,environment,identity}=useSquad(),client=useQueryClient();
 const query=useSquadQuery(['studio-review',baseId,configuration],async({sdk})=>{
  const options=(kind,parentId,partId)=>client.fetchQuery({queryKey:['squad',scope,...(kind==='addons'?['custom-addon-options',environment,identity.id,baseId,parentId]:['configuration-options',environment,identity.id,baseId,kind,parentId,partId])],queryFn:({signal})=>loadConfiguratorOptions(sdk.withSignal?sdk.withSignal(signal):sdk,baseId,kind,{parentId,partId}),staleTime:300000});
  const find=(rows,id)=>rows.data.find(r=>String(r.id)===String(id))?.name??'Selection unavailable';
  const fabrics=await options('fabrics'),color=configuration.fabric_id?await options('fabric_colors',configuration.fabric_id):null;
  const rows=[{id:'fabric',stage:'Fabric',label:'Fabric & colour',value:[configuration.fabric_id?find(fabrics,configuration.fabric_id):'Choose fabric',configuration.fabric_color_id&&color?find(color,configuration.fabric_color_id):'Choose colour'].join(' · ')}];
  for(const part of allParts){const selected=configuration.parts.find(p=>p.part_id===part.id);if(!selected){rows.push({id:part.id,stage:'Parts',label:part.name,value:'No additional options'});continue;}
   const [addons,colors]=await Promise.all([options('addons',part.id),options('part_colors',part.id)]);const selections=[];
   if(selected.color_id)selections.push(find(colors,selected.color_id));
   for(const addon of selected.addons){let text=find(addons,addon.addon_id);if(addon.color_id)text+=' · '+find(await options('addon_colors',addon.addon_id,part.id),addon.color_id);selections.push(text);}
   rows.push({id:part.id,stage:'Parts',label:part.name,value:selections.join(', ')||'No additional options'});
  }return rows;
 },{staleTime:300000,refetchOnWindowFocus:false});
 return <div aria-label="Design specifications">{query.isLoading&&<div role="status" className="h-24 rounded-xl animate-pulse bg-muted" aria-label="Loading design summary"/>}{query.error&&<p role="alert">Could not load the design summary. <button onClick={()=>query.refetch()}>Retry</button></p>}{query.data?.map(row=><div key={row.id} className="studio-summary-row"><div><p className="font-medium">{row.label}</p><p className="text-xs text-muted-foreground mt-1">{row.value}</p></div><button type="button" onClick={()=>onEdit(row.stage,row.id)}>Edit</button></div>)}</div>;
}
