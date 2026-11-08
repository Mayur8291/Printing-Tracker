import * as fontkit from 'npm:fontkit@2.0.4';
import {Readable} from 'node:stream';
/** pdf-lib 1.17 expects fontkit 1's streaming subset encoder. Fontkit 2 fixes
 * Deno-incompatible prototype mutation and returns the same encoded bytes.
 * Adapt that one versioned interface; never patch globals or disable guards. */
export const pdfFontkit={create(bytes:Uint8Array){
 const font=fontkit.create(bytes);const create=font.createSubset.bind(font);
 font.createSubset=()=>{const subset=create();subset.encodeStream=()=>Readable.from([subset.encode()]);return subset;};
 return font;
}};
