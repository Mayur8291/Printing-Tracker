import {useState} from 'react';
import {Textarea} from '@/components/ui/textarea';
import {Field} from './CommerceUI';
import {ratingChoices,hasRatingChoice,toggleRatingChoice} from './ratingComments';
export default function RatingCommentInput({label,name,initial='',choices=false}){
 const [text,setText]=useState(initial??'');
 return <Field label={label}><div className="space-y-3">{choices&&<div className="flex flex-wrap gap-2" role="group" aria-label={`${label} choices`}>{ratingChoices.map(choice=><button key={choice} type="button" aria-pressed={hasRatingChoice(text,choice)} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hasRatingChoice(text,choice)?'border-primary bg-primary/10 text-primary':'border-input bg-background hover:bg-muted'}`} onClick={()=>setText(toggleRatingChoice(text,choice))}>{choice}</button>)}</div>}<Textarea aria-label={label} name={name} value={text} onChange={event=>setText(event.target.value)} maxLength={2000}/></div></Field>;
}
