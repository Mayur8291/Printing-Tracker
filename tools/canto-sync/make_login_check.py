from auth_test import keys,PROJECTS
from pathlib import Path
import json
configs={e:{'url':'https://'+r+'.supabase.co','key':keys(e)} for e,r in PROJECTS.items()}
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canto · Login check</title>
<style>body{font:16px system-ui;background:#f3f5f8;color:#172134;margin:0;display:grid;place-items:center;min-height:100vh}main{background:white;padding:40px;border-radius:20px;width:min(440px,80vw);box-shadow:0 15px 60px #1231}h1{margin:0 0 12px}p{color:#596579;line-height:1.5}label{display:block;margin-top:20px;font-weight:600}input,select,button{box-sizing:border-box;width:100%;padding:13px;border:1px solid #ccd2df;border-radius:8px;margin-top:7px;font:inherit}button{background:#194ee8;color:white;border:0;margin-top:25px;cursor:pointer}button:disabled{opacity:.5}#result{white-space:pre-wrap;padding-top:20px;line-height:1.5}.ok{color:#087949}.error{color:#b32828}small{display:block;margin-top:20px;color:#647087}</style>
<main><h1>Canto login check</h1><p>Use your existing Scott email and password to check access to the new authentication system.</p>
<form id="form"><label for="environment">Environment</label><select id="environment"><option value="staging">Staging</option><option value="production">Production</option></select>
<label for="email">Existing email</label><input id="email" type="text" autocomplete="username" required>
<label for="password">Existing password</label><input id="password" type="password" autocomplete="current-password" required>
<button id="submit">Check login</button></form><div id="result" role="status" aria-live="polite"></div><small>This checks authentication only. Your password goes directly to the selected Supabase project. Nothing is saved in this browser.</small></main>
<script>
const configs=CONFIGS;
const roles=['Admin','Sales coordinator','Production coordinator','Customer','Factory manager','Tailor','Sub-tailor','Dispatch incharge','Inspector','Cutting master','Dealer','Job worker','Assistant worker'];
const form=document.getElementById('form'),result=document.getElementById('result'),button=document.getElementById('submit');
form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;document.getElementById('environment').disabled=true;result.className='';result.textContent='Checking…';const selectedEnvironment=document.getElementById('environment').value;const cfg=configs[selectedEnvironment];
try{const response=await fetch(cfg.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:cfg.key,'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});const data=await response.json();if(!response.ok)throw new Error(data.msg||data.error_description||'Login failed');
if(data.user.role!=='sa_app'||data.user.app_metadata.application!=='canto')throw new Error('This is a Printing Tracker account, not a migrated Canto account.');
const meta=data.user.app_metadata;result.className='ok';result.textContent='Login successful\\nLegacy user ID: '+meta.legacy_user_id+'\\nRole: '+(roles[meta.legacy_role_id]||meta.legacy_role_id)+'\\nEnvironment: '+selectedEnvironment;
await fetch(cfg.url+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:cfg.key,Authorization:'Bearer '+data.access_token}});
}catch(error){result.className='error';result.textContent=error.message;}finally{document.getElementById('password').value='';button.disabled=false;document.getElementById('environment').disabled=false;}});
document.getElementById('environment').addEventListener('change',()=>{result.textContent='';document.getElementById('password').value='';});
</script></html>'''
Path('login-check.html').write_text(page.replace('CONFIGS',json.dumps(configs)))
print('Login checker generated with public anon keys only.')
