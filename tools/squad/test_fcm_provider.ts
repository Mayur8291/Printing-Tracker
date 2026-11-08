/** Read-only FCM validation. Private account/token input arrives through stdin.
 * This executable has no option that can send a notification to a person. */
import {fcmPush} from '../../supabase/functions/squad-jobs/notifications.ts';
const input=JSON.parse(await new Response(Deno.stdin.readable).text());
const result=await fcmPush(input.account,'validate_only')({id:'validation-only',revision:'1',token:input.token,platform:'android'},{notificationId:'0',generation:'0'});
console.log(JSON.stringify({mode:'validate_only',result:typeof result==='string'?result:result.code,notifications_sent:0}));
