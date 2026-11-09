// Pinned Flutter5d55d946 global_constants.dart310; Rails stores ' , ' joined labels.
export const ratingChoices=['Delivery Speed','Product Quality','Customer Support','Order Pricing'];
export function hasRatingChoice(value,choice){return String(value??'').split(/\s*,\s*/).includes(choice);}
export function toggleRatingChoice(value,choice){
 const text=String(value??'');if(!ratingChoices.includes(choice))return text;
 if(!hasRatingChoice(text,choice))return text.trim()?`${text} , ${choice}`:choice;
 return text.split(/\s*,\s*/).filter(part=>part!==choice).join(' , ');
}
