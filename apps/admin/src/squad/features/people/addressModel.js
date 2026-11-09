// Exact pinned Flutter5d55d946 assets/json/country.json; provider spellings matter.
import country from './country.json' with {type:'json'};
export const states=country.states;
const folded=value=>String(value??'').trim().toLocaleLowerCase('en-IN');
export function canonicalState(value){return states.find(row=>folded(row.state)===folded(value))??null;}
export function canonicalLocation(state,city){const match=canonicalState(state),town=match?.cities.find(value=>folded(value)===folded(city));return match&&town?{state:match.state,city:town}:null;}
export function locationError(state,city,{legacy,allowLegacy=false}={}){
 if(allowLegacy&&legacy&&state===legacy.state&&city===legacy.city)return null;
 if(!canonicalState(state))return 'Choose a state from the existing application’s list.';
 if(!canonicalLocation(state,city))return 'Choose a city listed for the selected state.';
 return null;
}
