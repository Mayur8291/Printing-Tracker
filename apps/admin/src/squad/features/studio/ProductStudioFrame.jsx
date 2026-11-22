import {useState} from 'react';
import {ArrowRight,Check,RotateCcw} from 'lucide-react';
import './studio.css';
const stages=['Fabric','Parts','Artwork','Review','Sizes'];
export default function ProductStudioFrame({name,stage,setStage,preview,children,footer,onUndo,canUndo}){
 return <section data-testid="product-studio" className="product-studio" aria-label="Product studio">
  <header className="studio-intro"><div><p className="studio-eyebrow">YOUR DESIGN, EVERY DETAIL</p><h2>Build it, part by part.</h2><p>The garment stays with you. Make every detail yours.</p></div><span className="studio-brand">Scott One / Parts Studio</span></header>
  <nav className="studio-stages" aria-label="Design stages">{stages.map((label,index)=><button key={label} type="button" aria-current={stage===label?'step':undefined} onClick={()=>setStage(label)}><span>{index+1}</span>{label}</button>)}</nav>
  <div className="studio-workspace"><div className="studio-garment"><div className="studio-garment-heading"><span className="studio-eyebrow">MADE BY YOU</span><h3>{name||'Your next favourite.'}</h3></div>{preview}<p className="studio-preview-caption">One garment. Every detail, yours.</p></div><div className="studio-editor"><header className="studio-editor-heading"><span className="studio-eyebrow">{stage==='Review'?'YOUR DESIGN':'MAKE IT YOURS'}</span>{canUndo&&<button type="button" onClick={onUndo}><RotateCcw size={14}/> Undo</button>}</header><div className="studio-editor-content">{children}</div><footer className="studio-actions">{footer}{stage!=='Review'&&stage!=='Sizes'&&<button className="studio-primary" type="button" onClick={()=>setStage(stages[stages.indexOf(stage)+1])}>{stage==='Artwork'?'Review design':`Done with ${stage.toLowerCase()}`}<ArrowRight size={17}/></button>}</footer></div></div>
 </section>;
}
export function PartTabs({parts,value,onChange,configuration}){
 return <div className="studio-part-tabs" role="tablist" aria-label="Garment parts">{parts.map(part=><button key={part.id} id={`part-tab-${part.id}`} role="tab" type="button" aria-selected={value===part.id} aria-controls={`part-panel-${part.id}`} tabIndex={value===part.id?0:-1} onClick={()=>onChange(part.id)} onKeyDown={event=>{const index=parts.indexOf(part);let next;if(event.key==='ArrowRight')next=(index+1)%parts.length;if(event.key==='ArrowLeft')next=(index+parts.length-1)%parts.length;if(event.key==='Home')next=0;if(event.key==='End')next=parts.length-1;if(next!==undefined){event.preventDefault();onChange(parts[next].id);document.getElementById(`part-tab-${parts[next].id}`)?.focus();}}}>{part.name}{configuration.parts.some(p=>p.part_id===part.id&&p.addons.length>0)&&<Check size={12}/>}</button>)}</div>;
}
