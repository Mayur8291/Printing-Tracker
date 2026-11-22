import type {CatalogueOption} from '@canto/shared/squad';
import type {Selection} from './selection';
import type {StudioCatalogueRows} from './studio-preview-model';

/** Explicit catalogue identities verified read-only in production and staging.
 * This map supplies geometry only. Current scoped SDK rows supply validity and colors.
 * Evidence: output/native-parts-studio-20261122/production-catalogue-216.json.
 */
export const STUDIO_MODEL_ID = 'rn-men-216-v1' as const;
export const STUDIO_BASE_ID = '216' as const;
export const STUDIO_PART_IDS = ["202", "192", "217", "214", "198", "213", "336", "253"] as const;
const FABRIC_IDS = new Set(["186", "187", "189", "190", "191", "193", "194", "195", "196", "199", "200", "201", "202", "203", "204", "205", "207", "209", "210", "212", "213", "214", "215", "216", "217", "218", "219", "220", "221", "224", "227", "228", "229", "232", "234", "235", "237", "238"]);
const PROJECT_REFS = new Set(['levwrmvqdntngeasrtnb','scvojtvgnkmbupvyslmb']);
export type StudioLength = 'short'|'threeQuarter'|'full';
export type StudioBinding = {id:string;part_id:string;name:string;has_color:boolean;selection_type:0|1;group:string;modelGroup:string;material:string|null;representation:'geometry'|'none'|'metadata';length?:StudioLength;requiresLength?:StudioLength};
export const STUDIO_BINDINGS: readonly StudioBinding[] = [
  {
    "id": "748",
    "part_id": "192",
    "name": "RN-N-Siri",
    "has_color": true,
    "selection_type": 0,
    "group": "group1",
    "modelGroup": "Addon_748",
    "material": "Addon_748_Fabric",
    "representation": "geometry"
  },
  {
    "id": "751",
    "part_id": "192",
    "name": "RN-N-Neck Tape",
    "has_color": true,
    "selection_type": 0,
    "group": "group1",
    "modelGroup": "Addon_751",
    "material": "Addon_751_Fabric",
    "representation": "geometry"
  },
  {
    "id": "730",
    "part_id": "192",
    "name": "RN-N-Moon Patch",
    "has_color": true,
    "selection_type": 1,
    "group": "group1",
    "modelGroup": "Addon_730",
    "material": "Addon_730_Fabric",
    "representation": "geometry"
  },
  {
    "id": "715",
    "part_id": "192",
    "name": "RN-N-Hanger Loop",
    "has_color": false,
    "selection_type": 1,
    "group": "group1",
    "modelGroup": "Addon_715",
    "material": null,
    "representation": "geometry"
  },
  {
    "id": "721",
    "part_id": "192",
    "name": "RN-N-Backreflector Loop",
    "has_color": false,
    "selection_type": 1,
    "group": "group1",
    "modelGroup": "Addon_721",
    "material": null,
    "representation": "metadata"
  },
  {
    "id": "753",
    "part_id": "198",
    "name": "RN-SHO-Plain",
    "has_color": false,
    "selection_type": 0,
    "group": "group4",
    "modelGroup": "Addon_753",
    "material": null,
    "representation": "none"
  },
  {
    "id": "1012",
    "part_id": "198",
    "name": "RN-SHO-RAG-Plain",
    "has_color": false,
    "selection_type": 0,
    "group": "group5",
    "modelGroup": "Addon_1012",
    "material": null,
    "representation": "none"
  },
  {
    "id": "749",
    "part_id": "198",
    "name": "RN-SHO-Edge Piping",
    "has_color": true,
    "selection_type": 0,
    "group": "group4",
    "modelGroup": "Addon_749",
    "material": "Addon_749_Fabric",
    "representation": "geometry"
  },
  {
    "id": "925",
    "part_id": "198",
    "name": "RN-SHO-RAG-Edge Piping",
    "has_color": true,
    "selection_type": 0,
    "group": "group5",
    "modelGroup": "Addon_925",
    "material": "Addon_925_Fabric",
    "representation": "geometry"
  },
  {
    "id": "734",
    "part_id": "198",
    "name": "RN-SHO-1 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group4",
    "modelGroup": "Addon_734",
    "material": "Addon_734_Fabric",
    "representation": "geometry"
  },
  {
    "id": "1023",
    "part_id": "198",
    "name": "RN-SHO-RAG-1 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group5",
    "modelGroup": "Addon_1023",
    "material": "Addon_1023_Fabric",
    "representation": "geometry"
  },
  {
    "id": "733",
    "part_id": "198",
    "name": "RN-SHO-2 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group4",
    "modelGroup": "Addon_733",
    "material": "Addon_733_Fabric",
    "representation": "geometry"
  },
  {
    "id": "858",
    "part_id": "198",
    "name": "RN-SHO-RAG-2 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group5",
    "modelGroup": "Addon_858",
    "material": "Addon_858_Fabric",
    "representation": "geometry"
  },
  {
    "id": "745",
    "part_id": "198",
    "name": "RN-SHO-3 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group4",
    "modelGroup": "Addon_745",
    "material": "Addon_745_Fabric",
    "representation": "geometry"
  },
  {
    "id": "1067",
    "part_id": "198",
    "name": "RN-SHO-RAG-3 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group5",
    "modelGroup": "Addon_1067",
    "material": "Addon_1067_Fabric",
    "representation": "geometry"
  },
  {
    "id": "717",
    "part_id": "198",
    "name": "RN-SHO-Patti",
    "has_color": true,
    "selection_type": 0,
    "group": "group4",
    "modelGroup": "Addon_717",
    "material": "Addon_717_Fabric",
    "representation": "geometry"
  },
  {
    "id": "1006",
    "part_id": "198",
    "name": "RN-SHO-RAG-Patti",
    "has_color": true,
    "selection_type": 0,
    "group": "group5",
    "modelGroup": "Addon_1006",
    "material": "Addon_1006_Fabric",
    "representation": "geometry"
  },
  {
    "id": "1193",
    "part_id": "202",
    "name": "RN-B-No Panel",
    "has_color": false,
    "selection_type": 0,
    "group": "group2",
    "modelGroup": "Addon_1193",
    "material": null,
    "representation": "none"
  },
  {
    "id": "1219",
    "part_id": "202",
    "name": "RN-B-2 Panel",
    "has_color": true,
    "selection_type": 0,
    "group": "group2",
    "modelGroup": "Addon_1219",
    "material": "Addon_1219_Fabric",
    "representation": "geometry"
  },
  {
    "id": "1218",
    "part_id": "202",
    "name": "RN-B-3 Panel",
    "has_color": true,
    "selection_type": 0,
    "group": "group2",
    "modelGroup": "Addon_1218",
    "material": "Addon_1218_Fabric",
    "representation": "geometry"
  },
  {
    "id": "1259",
    "part_id": "202",
    "name": "RN-B-4 Panel",
    "has_color": true,
    "selection_type": 0,
    "group": "group2",
    "modelGroup": "Addon_1259",
    "material": "Addon_1259_Fabric",
    "representation": "geometry"
  },
  {
    "id": "719",
    "part_id": "213",
    "name": "RN-PKT-U Pocket",
    "has_color": true,
    "selection_type": 0,
    "group": "group3",
    "modelGroup": "Addon_719",
    "material": "Addon_719_Fabric",
    "representation": "geometry"
  },
  {
    "id": "718",
    "part_id": "213",
    "name": "RN-PKT-Square Pocket",
    "has_color": true,
    "selection_type": 0,
    "group": "group3",
    "modelGroup": "Addon_718",
    "material": "Addon_718_Fabric",
    "representation": "geometry"
  },
  {
    "id": "738",
    "part_id": "213",
    "name": "RN-PKT-V Pocket",
    "has_color": true,
    "selection_type": 0,
    "group": "group3",
    "modelGroup": "Addon_738",
    "material": "Addon_738_Fabric",
    "representation": "geometry"
  },
  {
    "id": "723",
    "part_id": "214",
    "name": "RN-ST-FS- Self",
    "has_color": false,
    "selection_type": 1,
    "group": "group9",
    "modelGroup": "Addon_723",
    "material": null,
    "representation": "geometry",
    "requiresLength": "full"
  },
  {
    "id": "731",
    "part_id": "214",
    "name": "RN-ST-3/4- Self",
    "has_color": false,
    "selection_type": 1,
    "group": "group10",
    "modelGroup": "Addon_731",
    "material": null,
    "representation": "geometry",
    "requiresLength": "threeQuarter"
  },
  {
    "id": "741",
    "part_id": "214",
    "name": "RN-ST-HS-Self",
    "has_color": false,
    "selection_type": 1,
    "group": "group8",
    "modelGroup": "Addon_741",
    "material": null,
    "representation": "geometry",
    "requiresLength": "short"
  },
  {
    "id": "710",
    "part_id": "214",
    "name": "RN-ST-HS-Self+Piping",
    "has_color": true,
    "selection_type": 1,
    "group": "group8",
    "modelGroup": "Addon_710",
    "material": "Addon_710_Fabric",
    "representation": "geometry",
    "requiresLength": "short"
  },
  {
    "id": "711",
    "part_id": "214",
    "name": "RN-ST-FS-Self+Piping",
    "has_color": true,
    "selection_type": 1,
    "group": "group9",
    "modelGroup": "Addon_711",
    "material": "Addon_711_Fabric",
    "representation": "geometry",
    "requiresLength": "full"
  },
  {
    "id": "736",
    "part_id": "214",
    "name": "RN-ST-3/4-Self+Piping",
    "has_color": true,
    "selection_type": 1,
    "group": "group10",
    "modelGroup": "Addon_736",
    "material": "Addon_736_Fabric",
    "representation": "geometry",
    "requiresLength": "threeQuarter"
  },
  {
    "id": "709",
    "part_id": "214",
    "name": "RN-ST-3/4- Raglan",
    "has_color": true,
    "selection_type": 1,
    "group": "group10",
    "modelGroup": "Addon_709",
    "material": "Addon_709_Fabric",
    "representation": "geometry",
    "requiresLength": "threeQuarter"
  },
  {
    "id": "732",
    "part_id": "214",
    "name": "RN-ST-HS-Raglan",
    "has_color": true,
    "selection_type": 1,
    "group": "group8",
    "modelGroup": "Addon_732",
    "material": "Addon_732_Fabric",
    "representation": "geometry",
    "requiresLength": "short"
  },
  {
    "id": "747",
    "part_id": "214",
    "name": "RN-ST-FS- Raglan",
    "has_color": true,
    "selection_type": 1,
    "group": "group9",
    "modelGroup": "Addon_747",
    "material": "Addon_747_Fabric",
    "representation": "geometry",
    "requiresLength": "full"
  },
  {
    "id": "713",
    "part_id": "214",
    "name": "RN-ST-FS-1 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group9",
    "modelGroup": "Addon_713",
    "material": "Addon_713_Fabric",
    "representation": "geometry",
    "requiresLength": "full"
  },
  {
    "id": "740",
    "part_id": "214",
    "name": "RN-ST-HS-1 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group8",
    "modelGroup": "Addon_740",
    "material": "Addon_740_Fabric",
    "representation": "geometry",
    "requiresLength": "short"
  },
  {
    "id": "752",
    "part_id": "214",
    "name": "RN-ST-3/4-1 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group10",
    "modelGroup": "Addon_752",
    "material": "Addon_752_Fabric",
    "representation": "geometry",
    "requiresLength": "threeQuarter"
  },
  {
    "id": "720",
    "part_id": "214",
    "name": "RN-ST-3/4- 2 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group10",
    "modelGroup": "Addon_720",
    "material": "Addon_720_Fabric",
    "representation": "geometry",
    "requiresLength": "threeQuarter"
  },
  {
    "id": "735",
    "part_id": "214",
    "name": "RN-ST-FS-2 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group9",
    "modelGroup": "Addon_735",
    "material": "Addon_735_Fabric",
    "representation": "geometry",
    "requiresLength": "full"
  },
  {
    "id": "739",
    "part_id": "214",
    "name": "RN-ST-HS-2 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group8",
    "modelGroup": "Addon_739",
    "material": "Addon_739_Fabric",
    "representation": "geometry",
    "requiresLength": "short"
  },
  {
    "id": "716",
    "part_id": "214",
    "name": "RN-ST-HS-3 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group8",
    "modelGroup": "Addon_716",
    "material": "Addon_716_Fabric",
    "representation": "geometry",
    "requiresLength": "short"
  },
  {
    "id": "737",
    "part_id": "214",
    "name": "RN-ST-FS-3 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group9",
    "modelGroup": "Addon_737",
    "material": "Addon_737_Fabric",
    "representation": "geometry",
    "requiresLength": "full"
  },
  {
    "id": "746",
    "part_id": "214",
    "name": "RN-ST-3/4- 3 Stripe",
    "has_color": true,
    "selection_type": 0,
    "group": "group10",
    "modelGroup": "Addon_746",
    "material": "Addon_746_Fabric",
    "representation": "geometry",
    "requiresLength": "threeQuarter"
  },
  {
    "id": "712",
    "part_id": "214",
    "name": "RN-ST-HS-Patti",
    "has_color": true,
    "selection_type": 0,
    "group": "group8",
    "modelGroup": "Addon_712",
    "material": "Addon_712_Fabric",
    "representation": "geometry",
    "requiresLength": "short"
  },
  {
    "id": "729",
    "part_id": "214",
    "name": "RN-ST-FS-Patti",
    "has_color": true,
    "selection_type": 0,
    "group": "group9",
    "modelGroup": "Addon_729",
    "material": "Addon_729_Fabric",
    "representation": "geometry",
    "requiresLength": "full"
  },
  {
    "id": "743",
    "part_id": "214",
    "name": "RN-ST-3/4- Patti",
    "has_color": true,
    "selection_type": 0,
    "group": "group10",
    "modelGroup": "Addon_743",
    "material": "Addon_743_Fabric",
    "representation": "geometry",
    "requiresLength": "threeQuarter"
  },
  {
    "id": "742",
    "part_id": "217",
    "name": "RN-SL-Half Sleeve",
    "has_color": true,
    "selection_type": 0,
    "group": "group6",
    "modelGroup": "Addon_742",
    "material": "Addon_742_Fabric",
    "representation": "geometry",
    "length": "short"
  },
  {
    "id": "744",
    "part_id": "217",
    "name": "RN-SL-Full Sleeve",
    "has_color": true,
    "selection_type": 0,
    "group": "group6",
    "modelGroup": "Addon_744",
    "material": "Addon_744_Fabric",
    "representation": "geometry",
    "length": "full"
  },
  {
    "id": "750",
    "part_id": "217",
    "name": "RN-SL-3/4th Sleeve",
    "has_color": true,
    "selection_type": 0,
    "group": "group6",
    "modelGroup": "Addon_750",
    "material": "Addon_750_Fabric",
    "representation": "geometry",
    "length": "threeQuarter"
  },
  {
    "id": "1277",
    "part_id": "253",
    "name": "RN-LAB- Black Size Label",
    "has_color": false,
    "selection_type": 1,
    "group": "group7",
    "modelGroup": "Addon_1277",
    "material": null,
    "representation": "metadata"
  },
  {
    "id": "1311",
    "part_id": "253",
    "name": "RN-LAB- Custom Woven Label",
    "has_color": false,
    "selection_type": 1,
    "group": "group7",
    "modelGroup": "Addon_1311",
    "material": null,
    "representation": "metadata"
  },
  {
    "id": "1242",
    "part_id": "253",
    "name": "RN-LAB- Heat Press Label",
    "has_color": false,
    "selection_type": 1,
    "group": "group7",
    "modelGroup": "Addon_1242",
    "material": null,
    "representation": "metadata"
  },
  {
    "id": "1247",
    "part_id": "253",
    "name": "RN-LAB- Wash Care Label",
    "has_color": false,
    "selection_type": 1,
    "group": "group7",
    "modelGroup": "Addon_1247",
    "material": null,
    "representation": "metadata"
  },
  {
    "id": "1326",
    "part_id": "253",
    "name": "RN-LAB- Loop Label",
    "has_color": false,
    "selection_type": 1,
    "group": "group7",
    "modelGroup": "Addon_1326",
    "material": null,
    "representation": "metadata"
  },
  {
    "id": "1248",
    "part_id": "253",
    "name": "RN-LAB- Custom Label",
    "has_color": false,
    "selection_type": 1,
    "group": "group7",
    "modelGroup": "Addon_1248",
    "material": null,
    "representation": "metadata"
  },
  {
    "id": "1225",
    "part_id": "253",
    "name": "RN-LAB- Custom Hangtag",
    "has_color": false,
    "selection_type": 1,
    "group": "group7",
    "modelGroup": "Addon_1225",
    "material": null,
    "representation": "metadata"
  },
  {
    "id": "1268",
    "part_id": "336",
    "name": "RN-TB- No Slit",
    "has_color": false,
    "selection_type": 0,
    "group": "group7",
    "modelGroup": "Addon_1268",
    "material": null,
    "representation": "none"
  },
  {
    "id": "1300",
    "part_id": "336",
    "name": "RN-TB- Fabric Slit",
    "has_color": true,
    "selection_type": 0,
    "group": "group7",
    "modelGroup": "Addon_1300",
    "material": "Addon_1300_Fabric",
    "representation": "geometry"
  },
  {
    "id": "1317",
    "part_id": "336",
    "name": "RN-TB- Tape Slit",
    "has_color": true,
    "selection_type": 0,
    "group": "group7",
    "modelGroup": "Addon_1317",
    "material": "Addon_1317_Fabric",
    "representation": "geometry"
  },
  {
    "id": "1276",
    "part_id": "336",
    "name": "RN-TB- Bartack",
    "has_color": true,
    "selection_type": 1,
    "group": "group7",
    "modelGroup": "Addon_1276",
    "material": "Addon_1276_Fabric",
    "representation": "metadata"
  }
];
const BY_ADDON = new Map(STUDIO_BINDINGS.map(row=>[row.id,row]));
const PARTS = new Set<string>(STUDIO_PART_IDS);
const PART_MATERIAL_IDS = new Set(['202','192','217','214','198','213','336']);
export type StudioMappedDesign = {modelId:typeof STUDIO_MODEL_ID;visibleGroups:string[];materialColors:Record<string,string>};
export type StudioResolution = {status:'supported';design:StudioMappedDesign;nonVisualDetails:string[]}|{status:'incomplete';design:StudioMappedDesign;nonVisualDetails:string[];pendingFields:string[]}|{status:'unsupported';reason:string};
export type StudioConfiguredPart = {part_id:string;color_id:string;addons:readonly {addon_id:string;color_id?:string|null}[]};
export function isStudioBase(projectRef:string,baseId:string|undefined|null):boolean{return PROJECT_REFS.has(projectRef)&&baseId===STUDIO_BASE_ID}
export function studioBinding(partId:string,addonId:string):StudioBinding|undefined{const row=BY_ADDON.get(addonId);return row?.part_id===partId?row:undefined}
function colorHex(rows:readonly CatalogueOption[]|undefined,id:string|undefined|null):string|null{
 if(!id||!rows)return null;const found=rows.filter(row=>row.id===id);if(found.length!==1)return null;
 const hex=found[0].hex;if(typeof hex!=='string'||!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex))return null;
 return (hex.length===4?'#'+[...hex.slice(1)].map(c=>c+c).join(''):hex).toLowerCase();
}
function unique(rows:readonly CatalogueOption[]|undefined,id:string):CatalogueOption|null{const found=rows?.filter(row=>row.id===id)??[];return found.length===1?found[0]:null}
function darker(hex:string,factor:number):string{return '#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*factor).toString(16).padStart(2,'0')).join('')}
const unavailable=(reason:string):StudioResolution=>({status:'unsupported',reason});
/** Strict by default. The editing preview can inherit unfinished colours visually, without writing defaults into the design. Unknown IDs and incompatible geometry always fail closed. */
export function resolveStudioDesign(input:{projectRef:string;selection:Selection;parts:readonly StudioConfiguredPart[];catalogue:StudioCatalogueRows;previewIncomplete?:boolean}):StudioResolution{
 const {projectRef,selection,parts,catalogue,previewIncomplete=false}=input;
 const pendingFields:string[]=[];
 if(previewIncomplete){
  if(!selection.designCategory)pendingFields.push('Choose a category.');
  if(!selection.fabric)pendingFields.push('Choose a fabric.');
  if(!selection.color)pendingFields.push('Choose a fabric colour.');
 }
 if(!isStudioBase(projectRef,selection.base?.id))return unavailable('This product uses the standard preview.');
 if(parts.length>50||parts.reduce((n,p)=>n+p.addons.length,0)>100)return unavailable('Too many selected details for the 3D preview.');
 if(selection.designCategory&&selection.designCategory.id!=='25')return unavailable('This category has no verified 3D mapping.');
 if(selection.fabric&&!FABRIC_IDS.has(selection.fabric.id))return unavailable('This fabric has no verified 3D mapping.');
 const body=selection.color?colorHex(catalogue.fabricColors,selection.color.id):null;
 if(selection.color&&!selection.fabric)return unavailable('Choose a fabric before its colour.');
 if(selection.color&&!body)return unavailable('The selected fabric colour is unavailable.');
 if(parts.length&&!body){if(!previewIncomplete)return unavailable('Choose a valid fabric colour before configuring parts.');if(!pendingFields.includes('Choose a fabric colour.'))pendingFields.push('Choose a fabric colour.');}
 const baseColor=body??'#e3dfd8';
 const colors:Record<string,string>={BaseFabric:baseColor,InteriorFabric216:darker(baseColor,.35),ThreadBody:darker(baseColor,.80)};
 for(const id of PART_MATERIAL_IDS)colors[`Part_${id}_Fabric`]=baseColor;
 const visible=new Set(['Base','Body_Closed']);const nonVisualDetails:string[]=[];const selected:StudioBinding[]=[];const seenParts=new Set<string>();
 for(const part of parts){
  if(seenParts.has(part.part_id)||!PARTS.has(part.part_id)||!unique(catalogue.parts,part.part_id))return unavailable('A selected part is unavailable or has no verified 3D mapping.');
  seenParts.add(part.part_id);
  const partColor=colorHex(catalogue.partColorsByPart[part.part_id],part.color_id);
  if(!partColor){
   if(!previewIncomplete||part.color_id)return unavailable('A selected part colour is unavailable.');
   pendingFields.push(`Choose a colour for ${unique(catalogue.parts,part.part_id)!.name}.`);
  }
  if(PART_MATERIAL_IDS.has(part.part_id))colors[`Part_${part.part_id}_Fabric`]=partColor??baseColor;
  const groups=new Map<string,StudioBinding[]>();const seenAddons=new Set<string>();
  for(const chosen of part.addons){
   const binding=studioBinding(part.part_id,chosen.addon_id),option=unique(catalogue.addonsByPart[part.part_id],chosen.addon_id);
   if(!binding||!option||seenAddons.has(chosen.addon_id))return unavailable('A selected detail has no verified 3D mapping.');
   seenAddons.add(chosen.addon_id);
   if(option.has_color!==binding.has_color||option.selection_type!==binding.selection_type||(option.group??'')!==binding.group)return unavailable('A catalogue detail changed. Its 3D mapping needs review.');
   const peers=groups.get(binding.group)??[];peers.push(binding);groups.set(binding.group,peers);
   if(binding.has_color){
    const addonColor=colorHex(catalogue.addonColorsByAddon[`${part.part_id}:${chosen.addon_id}`],chosen.color_id);
    if(!addonColor){if(!previewIncomplete||chosen.color_id)return unavailable('A selected detail colour is unavailable.');pendingFields.push(`Choose a colour for ${binding.name}.`);}
    if(binding.material&&binding.representation!=='metadata')colors[binding.material]=addonColor??partColor??baseColor;
   }
   else if(chosen.color_id!=null)return unavailable('A detail without colour has an unexpected colour selection.');
   selected.push(binding);visible.add(binding.modelGroup);
   if(binding.representation==='metadata')nonVisualDetails.push(`${binding.name}: saved with the design; its placement and appearance are not shown in this preview.`);
  }
  if([...groups.values()].some(rows=>rows.length>1&&rows.some(row=>row.selection_type===0)))return unavailable('Conflicting choices in a single-selection group.');
 }
 const lengths=selected.filter(row=>row.length);if(lengths.length>1)return unavailable('Select only one sleeve length.');
 const length=lengths[0]?.length;
 if(selected.some(row=>row.requiresLength&&row.requiresLength!==length))return unavailable('The sleeve detail does not match the selected sleeve length.');
 const raglan=selected.find(row=>['709','732','747'].includes(row.id));
 if(lengths[0]&&raglan)visible.delete(lengths[0].modelGroup); // raglan geometry contains the complete matching sleeve.
 if(lengths[0]&&!raglan)visible.add(`SetInSeams_${lengths[0].id}`);
 if(!raglan)visible.add('SetInShoulderSeams');
 if(selected.some(row=>row.id==='1300'||row.id==='1317')){visible.delete('Body_Closed');visible.add('Body_Slit');}
 const resolvedBody=colors.Part_202_Fabric;colors.ThreadBody=darker(resolvedBody,.8);colors.InteriorFabric216=darker(resolvedBody,.35);
 const design={modelId:STUDIO_MODEL_ID,visibleGroups:[...visible].sort(),materialColors:colors};
 return pendingFields.length?{status:'incomplete',design,nonVisualDetails,pendingFields}:{status:'supported',design,nonVisualDetails};
}
