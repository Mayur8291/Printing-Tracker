"""Reproduce the static source inventory; never executes application code or exports credentials."""
import csv,hashlib,json,re,subprocess
from functools import lru_cache
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
REPOS={'flutter':ROOT.parent/'Canto/scott-flutter','rails':ROOT.parent/'Canto/scott-international-backend'}
BASELINES={'flutter':('origin/develop','5d55d9461af18b94a867dce07dee7c4b76f1e51f'),'rails':('main','14277820c78e018e62be3da1a14cd8d716cdbf02')}
def git(repo,*args):return subprocess.check_output(['git','-C',str(REPOS[repo]),*args],stderr=subprocess.DEVNULL).decode()
@lru_cache(maxsize=None)
def source(repo,path,ref=None):return git(repo,'show',(ref or BASELINES[repo][1])+':'+path)
def write(name,rows,fields=None):
 if not rows:raise ValueError(name+' has no rows')
 with (OUT/name).open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=fields or list(rows[0]),lineterminator='\n');w.writeheader();w.writerows(rows)
def files(repo):
 return [p for p in git(repo,'ls-tree','-r','--name-only',BASELINES[repo][1]).splitlines() if (repo=='flutter' and p.startswith('lib/') and p.endswith('.dart')) or (repo=='rails' and ((p.startswith(('app/','db/migrate/')) and p.endswith(('.rb','.erb'))) or p in ['config/routes.rb','config/sidekiq.yml','config/initializers/feature_flags.rb','db/schema.rb','lib/json_web_token.rb'] or p.startswith('lib/tasks/')))]
def methods(s,language):
 pattern=r'^\s*def\s+(?:self\.)?(\w+[!?=]?)' if language=='rails' else r'^  (?:static\s+)?(?:(?:Future(?:<[^\n]+?>)?|Stream(?:<[^\n]+?>)?|void|bool|int|double|String|[A-Z]\w*(?:<[^\n]+?>)?\??)\s+)?(\w+)\s*\('
 return [(m.group(1),s[:m.start()].count('\n')+1) for m in re.finditer(pattern,s,re.M) if m.group(1) not in ('if','for','while','switch','catch','return','super','assert')]

def routes(s):
 rows=[];stack=[]
 crud={'index':[('GET','')],'create':[('POST','')],'new':[('GET','/new')],'edit':[('GET','/:id/edit')],'show':[('GET','/:id')],'update':[('PATCH','/:id'),('PUT','/:id')],'destroy':[('DELETE','/:id')]}
 def prefix():return '/'+ '/'.join(x[1] for x in stack if x[0]=='namespace')
 def add(verb,path,controller,action,line):
  cp='app/controllers/'+controller+'_controller.rb'
  try:cs=source('rails',cp)
  except subprocess.CalledProcessError:cs=''
  mm=dict(methods(cs,'rails'));pos=mm.get(action)
  rows.append({'verb':verb,'path':path,'controller':controller,'action':action,'implemented':bool(pos),'source':'config/routes.rb:'+str(line),'handler':cp+(':'+str(pos) if pos else ''),'capability':''})
 for line,raw in enumerate(s.splitlines(),1):
  t=raw.strip()
  if not t or t.startswith('#'):continue
  m=re.match(r'namespace\s+:(\w+).*\bdo\s*$',t)
  if m:stack.append(('namespace',m[1]));continue
  m=re.match(r'resources\s+:(\w+)(.*)',t)
  if m:
   name,opts=m.groups();ctrl='/'.join([x[1] for x in stack if x[0]=='namespace']+[name]);path=prefix().rstrip('/')+'/'+name
   only=re.search(r'only:\s*\[([^]]*)\]',opts);actions=re.findall(r':(\w+)',only[1]) if only else list(crud)
   for action in actions:
    for verb,suffix in crud[action]:add(verb,path+suffix,ctrl,action,line)
   if re.search(r'\bdo\s*$',opts):stack.append(('resource',name))
   continue
  if t in ('collection do','member do'):stack.append((t.split()[0],''));continue
  m=re.match(r'(get|post|put|patch|delete)\s+:(\w+)',t)
  if m:
   verb,action=m.groups();res=next(x[1] for x in reversed(stack) if x[0]=='resource');ctrl='/'.join([x[1] for x in stack if x[0]=='namespace']+[res]);path=prefix().rstrip('/')+'/'+res+('/:id' if stack[-1][0]=='member' else '')+'/'+action
   add(verb.upper(),path,ctrl,action,line);continue
  m=re.match(r'(get|post|put|patch|delete)\s+["\']([^"\']+)["\'],\s*to:\s*["\']([^#]+)#([^"\']+)',t)
  if m:
   verb,path,ctrl,action=m.groups();add(verb.upper(),prefix().rstrip('/')+'/'+path,'/'.join([x[1] for x in stack if x[0]=='namespace']+[ctrl]),action,line);continue
  if t=='end' and stack:stack.pop()
 return rows

def main():
 manifest=[];controllers=[];services=[];views=[]
 for repo in BASELINES:
  for path in files(repo):
   text=source(repo,path);ms=methods(text,repo)
   manifest.append({'repository':repo,'commit':BASELINES[repo][1],'path':path,'lines':len(text.splitlines()),'sha256':hashlib.sha256(text.encode()).hexdigest(),'domain':'','disposition':''})
   if repo=='rails' and path.startswith('app/controllers/'):
    visibility='public'
    for line,t in enumerate(text.splitlines(),1):
     if re.match(r'^\s*(private|protected)\s*$',t):visibility=t.strip()
     m=re.match(r'^\s*def\s+(\w+[!?=]?)',t)
     if m:controllers.append({'path':path,'line':line,'method':m[1],'visibility':visibility,'capability':''})
   if repo=='flutter' and path.startswith('lib/services/'):
    for method,line in ms:services.append({'path':path,'line':line,'method':method,'capability':''})
   if repo=='flutter' and path.startswith('lib/ui/views/'):
    views.append({'path':path,'group':path.split('/')[3],'classes':';'.join(re.findall(r'\bclass\s+(\w+)',text)),'methods':';'.join(x[0] for x in ms),'capability':''})
 write('source-files.csv',manifest);write('legacy-routes.csv',routes(source('rails','config/routes.rb')));write('controller-methods.csv',controllers);write('flutter-services.csv',services);write('flutter-views.csv',views)
 permissions=[]
 s=source('flutter','lib/app/global_constants.dart')
 for m in re.finditer(r'List<Roles>\s+(\w+)\s*=\s*\[([^]]*)\]',s,re.S):
  body=re.sub(r'//[^\n]*','',m[2]);roles=re.findall(r'Roles\.(\w+)',body)
  permissions.append({'rule':m[1],'roles':';'.join(roles),'role_count':len(roles),'source':'lib/app/global_constants.dart:'+str(s[:m.start()].count('\n')+1)})
 write('legacy-role-rules.csv',permissions)
 tables=[]
 for m in re.finditer(r'^  create_table "([^"]+)".*?\n(.*?)^  end',source('rails','db/schema.rb'),re.M|re.S):
  tables.append({'table':m[1],'columns':';'.join(re.findall(r'^\s*t\.\w+ "([^"]+)"',m[2],re.M)),'source':'db/schema.rb:'+str(source('rails','db/schema.rb')[:m.start()].count('\n')+1),'domain':''})
 write('legacy-tables.csv',tables)
 changes=[]
 for repo,other in [('flutter','main'),('rails','origin/develop')]:
  other_sha=git(repo,'rev-parse',other).strip()
  for row in git(repo,'diff','--name-status',BASELINES[repo][1],other_sha,'--','lib','app','config/routes.rb','config/initializers/feature_flags.rb','db/schema.rb','pubspec.yaml').splitlines():
   status,path=row.split('\t',1)
   changes.append({'repository':repo,'compared_commit':other_sha,'change_relative_to_baseline':status,'path':path,'disposition':''})
 write('branch-differences.csv',changes)
 print(json.dumps({'source_files':len(manifest),'routes':len(routes(source('rails','config/routes.rb'))),'controller_methods':len(controllers),'flutter_service_methods':len(services),'flutter_view_files':len(views),'tables':len(tables),'role_rule_lists':len(permissions),'branch_differences':len(changes)}))
if __name__=='__main__':main()
