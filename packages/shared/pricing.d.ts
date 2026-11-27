import type {createSquadClient,CustomPricePreview,CustomPricePreviewRequest,CustomVolumePrice,Configuration,CatalogueOption,BrandingInput} from './squad';
export function priceSum(...prices:string[]):string;
export function priceDifference(after:string,before:string):string;
export function priceMoney(price:string):string;
export type QuotePriceChanges={previousTotal:string;total:string;lines:{line:number;previousTotal:string;total:string;components:string[]}[]};
export function quotePriceChanges(before:import('./squad').QuoteCalculation|null,after:import('./squad').QuoteCalculation):QuotePriceChanges|null;
export function optionPriceLabel(before:CustomVolumePrice,after:CustomVolumePrice,selected?:boolean):string;
export function readPricePreviews(input:{client:Pick<ReturnType<typeof createSquadClient>,'withSignal'>;request:CustomPricePreviewRequest;signal:AbortSignal;isCurrent:()=>boolean;customerId?:string;generation?:string}):Promise<CustomPricePreview>;
export function readOptionPriceDifferences(input:{client:Pick<ReturnType<typeof createSquadClient>,'withSignal'>;configuration:Configuration;part:CatalogueOption;partColorId:string;choices:CatalogueOption[];allParts:CatalogueOption[];quantity:number;sample?:boolean;brandings?:BrandingInput[];signal:AbortSignal;isCurrent:()=>boolean;customerId?:string;generation?:string}):Promise<Record<string,string>>;
