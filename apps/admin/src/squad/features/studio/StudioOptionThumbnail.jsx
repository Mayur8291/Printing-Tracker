import {useSquad} from '../../data/hooks';
import {getEnvironmentConfig} from '../../../runtimeEnv';
import {isStudioBase,studioBinding} from './studio-catalogue.generated';
const thumbnails=import.meta.glob('./assets/thumbnails/addon-*.png',{eager:true,query:'?url',import:'default'});
/** Only authored images with a verified product/part/option mapping may be shown. */
export default function StudioOptionThumbnail({baseId,partId,addonId,className=''}){
 const {environment}=useSquad();
 const projectRef=new URL(getEnvironmentConfig(environment).url).hostname.split('.')[0];
 if(!isStudioBase(projectRef,String(baseId))||!studioBinding(String(partId),String(addonId)))return null;
 const source=thumbnails[`./assets/thumbnails/addon-${addonId}.png`];
 return source?<img src={source} alt="" aria-hidden="true" loading="lazy" decoding="async" className={className} style={{width:'100%',height:110,objectFit:'contain',borderRadius:10}}/>:null;
}
