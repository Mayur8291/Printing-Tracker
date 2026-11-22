import type {Studio3DArtworkSide} from './studio3d/protocol';
const sides:Record<string,Studio3DArtworkSide>={'front':'front','back':'back','left chest':'leftChest','right chest':'rightChest','left sleeve':'leftSleeve','right sleeve':'rightSleeve','inner label':'innerLabel'};
export function studioArtworkPlacement(side:string,width:string,height:string){
 const target=sides[side.trim().toLowerCase()],w=Number(width),h=Number(height);
 return target&&Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0&&w<=100&&h<=100?{side:target,widthInches:w,heightInches:h}:null;
}
