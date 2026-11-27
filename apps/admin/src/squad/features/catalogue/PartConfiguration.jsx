import {readOptionPriceDifferences} from '@canto/shared/pricing';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Check,ChevronDown,Plus} from 'lucide-react';
import StudioOptionThumbnail from '../studio/StudioOptionThumbnail';
import {useSquadQuery} from '../../data/hooks';
import {QueryState} from '../orders/CommerceUI';
import {loadConfiguratorOptions,selectAddon,sleeveChoiceVisible,sleeveKind} from './addonSelection';

const title=name=>String(name??'').replace(/^RN[-\s]+(?:[A-Z]{1,4}[-\s]+)?/,'').replace(/^Tshirt /,'');
export default function PartConfiguration({pricing,sdk,identity,environment,canWrite,baseId,part,selected,onChange,OptionSelect,sleeveLengthChoice,sleeveLengthSelected}){
 const common={sdk,identity,environment,canWrite,baseId};
 const [pending,setPending]=useState(''),[error,setError]=useState('');
 const needsLength=sleeveKind(part)==='type'&&!sleeveLengthSelected;
 const query=useSquadQuery(['custom-addon-options',environment,identity.id,baseId,part.id],({sdk})=>loadConfiguratorOptions(sdk,baseId,'addons',{parentId:part.id}),{staleTime:300000,gcTime:1800000,refetchOnWindowFocus:false,enabled:!needsLength});
 const choices=query.data?.data??[],visible=sleeveKind(part)==='type'?choices.filter(choice=>sleeveChoiceVisible(choice,sleeveLengthChoice)):choices;
 const selection=selected??{part_id:part.id,color_id:'',addons:[]};
 const [prices,setPrices]=useState(null),[priceRetry,setPriceRetry]=useState(0);
 const priceKey=JSON.stringify([environment,identity.id,identity.write_state?.generation,pricing,part.id,choices,selection.color_id]);
 const priceLive=useRef(priceKey);priceLive.current=priceKey;
 useEffect(()=>{
  if(!pricing?.configuration.fabric_color_id||!pricing.configuration.category_id||!selection.color_id||needsLength||!choices.length)return;
  let active=true;const ac=new AbortController();let timeout;
  const timer=setTimeout(()=>{timeout=setTimeout(()=>{ac.abort();if(active)setPrices({key:priceKey,error:true})},15000);
   void readOptionPriceDifferences({...pricing,client:sdk,part,partColorId:selection.color_id,choices,signal:ac.signal,isCurrent:()=>active&&priceLive.current===priceKey,generation:identity.write_state?.generation}).then(labels=>{if(active&&!ac.signal.aborted)setPrices({key:priceKey,labels})}).catch(()=>{if(active&&!ac.signal.aborted)setPrices({key:priceKey,error:true})}).finally(()=>clearTimeout(timeout));
  },350);return()=>{active=false;clearTimeout(timer);clearTimeout(timeout);ac.abort()};
 },[sdk,priceKey,priceRetry]);
 const priceLabels=prices?.key===priceKey?prices:null;

 const groups=useMemo(()=>{
  const source=new Map();for(const row of visible){const key=row.group??'';if(!source.has(key))source.set(key,[]);source.get(key).push(row);}
  return [...source].flatMap(([key,rows],index)=>{
   const styles=rows.filter(row=>row.selection_type===0),extras=rows.filter(row=>row.selection_type!==0),suffix=source.size>1?` ${index+1}`:'';
   return [...(styles.length?[{key:`${key}:style`,name:`Style${suffix}`,hint:'Select one',rows:styles}]:[]),...(extras.length?[{key:`${key}:extras`,name:`Extras${suffix}`,hint:'Choose details',rows:extras}]:[])];
  });
 },[query.data,sleeveLengthChoice?.id,sleeveLengthChoice?.name,part.id]);
 useEffect(()=>{setPending('');setError('');},[sleeveLengthChoice?.id]);
 function apply(choice,colorId){setError('');try{onChange({...selection,addons:selectAddon(selection.addons,choice,colorId,choices)});setPending('');}catch(cause){setError(cause.message);}}
 function choose(choice){
  setError('');const existing=selection.addons.find(row=>row.addon_id===choice.id);
  if(existing&&!choice.has_color){onChange({...selection,addons:selection.addons.filter(row=>row.addon_id!==choice.id)});setPending('');return;}
  if(choice.has_color){setPending(current=>current===choice.id?'':choice.id);return;}
  apply(choice,'');
 }
 return <div className="studio-part-content">
  <div className="studio-part-title"><h3>{title(part.name)}</h3>{selected&&<button type="button" className="studio-text-action" onClick={()=>{setPending('');onChange(null);}}>Reset part</button>}</div>
  <p className="studio-part-description">Choose the details. Watch your garment take shape.</p>
  {needsLength?<p className="studio-prerequisite" role="status">Choose a sleeve length first to see compatible sleeve styles.</p>:<>
   <div className="studio-part-base-colour"><OptionSelect {...common} kind="part_colors" parentId={part.id} label={`${title(part.name)} colour`} value={selection.color_id} onChange={color_id=>onChange({...selection,color_id})}/></div>
   <QueryState query={query} empty={!visible.length} title="No extra details" description="Use the available colour choices to personalise this part.">
    {groups.map(group=><section key={group.key} className="studio-choice-group" aria-label={`${title(part.name)} ${group.name}`}>
     <div className="studio-group-heading"><h4>{group.name}</h4><span>{group.hint}</span></div>
     <div className={`studio-option-grid studio-visual-options${group.rows.length===3?' studio-three-options':''}`}>
      {group.rows.map(choice=>{
       const applied=selection.addons.some(row=>row.addon_id===choice.id),isPending=pending===choice.id;
       return <button key={choice.id} type="button" className="studio-option-card studio-visual-option" aria-label={`${choice.name}. ${priceLabels?.labels?.[choice.id]??(priceLabels?.error?'Price unavailable':selection.color_id?'Checking price':'Choose part colour for price')}`} aria-pressed={applied} data-pending={isPending||undefined} aria-expanded={choice.has_color?isPending||applied:undefined} onClick={()=>choose(choice)}>
        <span className="studio-option-picture"><StudioOptionThumbnail baseId={baseId} partId={part.id} addonId={choice.id}/></span>
        <span className={`studio-option-check${choice.selection_type!==0?' studio-extra-check':''}`} aria-hidden="true">{applied?<Check size={12}/>:isPending?<ChevronDown size={12}/>:choice.selection_type!==0?<Plus size={11}/>:null}</span>
        <span className="studio-option-name">{title(choice.name)}</span><span className="studio-option-note">{!selection.color_id?'Choose part colour for price':priceLabels?.labels?.[choice.id]??(priceLabels?.error?'Price unavailable':'Checking price…')}</span>
        {isPending&&!applied&&<span className="studio-option-note">Choose a colour below</span>}
       </button>;
      })}
     </div>
     {group.rows.filter(choice=>choice.has_color&&(selection.addons.some(row=>row.addon_id===choice.id)||pending===choice.id)).map(choice=>{
      const applied=selection.addons.find(row=>row.addon_id===choice.id);
      return <div key={choice.id} className="studio-inline-colour" data-addon-colour={choice.id}>
       <OptionSelect {...common} kind="addon_colors" parentId={choice.id} partId={part.id} label={`${title(choice.name)} colour`} value={applied?.color_id??''} onChange={colorId=>apply(choice,colorId)}/>
       <div className="studio-inline-actions">{applied?<button type="button" className="studio-text-action" aria-label={`Remove ${choice.name}`} onClick={()=>{setPending('');onChange({...selection,addons:selection.addons.filter(row=>row.addon_id!==choice.id)});}}>Remove detail</button>:<button type="button" className="studio-text-action" onClick={()=>setPending('')}>Cancel selection</button>}</div>
      </div>;
     })}
    </section>)}
   </QueryState>
  </>}
  {!query.isLoading&&selection.addons.filter(row=>!visible.some(choice=>choice.id===row.addon_id)).map(row=><div key={row.addon_id} className="studio-prerequisite"><p>A previously selected detail is unavailable for these choices.</p><button type="button" className="studio-text-action" aria-label={`Remove unavailable detail ${row.addon_id}`} onClick={()=>onChange({...selection,addons:selection.addons.filter(item=>item.addon_id!==row.addon_id)})}>Remove unavailable detail</button></div>)}
  {priceLabels?.error&&<button type="button" className="studio-text-action" onClick={()=>setPriceRetry(n=>n+1)}>Retry option prices</button>}
  {error&&<p role="alert" className="studio-part-error">{error}</p>}
  {selection.addons.length>0&&<p className="studio-selection-note"><Check size={13}/> {selection.addons.length} detail{selection.addons.length===1?'':'s'} selected. Colours apply as you choose.</p>}
 </div>;
}
