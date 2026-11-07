"""Validate audit cross-references and artifact integrity; does not test planned services."""
import csv,hashlib,json,re,subprocess
from pathlib import Path
from capabilities import MODULES,ROWS,PERSONAS
from build_plan import SUBJECTS
ROOT=Path(__file__).resolve().parent
def read(name):return list(csv.DictReader((ROOT/name).open()))
def require(ok,message):
 if not ok:raise AssertionError(message)
def main():
 workflows=read('functionality-matrix.csv');ids={r['id'] for r in workflows}
 require(len(ids)==len(ROWS),'Duplicate/missing workflow')
 require(ids=={r['id'] for r in ROWS},'Curated/rendered drift')
 require(set(SUBJECTS)<=ids,'Unknown subject workflow')
 masters=read('master-capabilities.csv');require({r['id'] for r in masters}==set(MODULES),'Missing module')
 names={v[0] for v in PERSONAS.values()}
 for r in workflows:
  actors=set(filter(None,(r['personas']+'; '+r['conditional_personas']).split('; ')))
  require(actors<=names,'Unknown actor '+r['id'])
  require(len(actors)==int(r['persona_count']),'Reuse count mismatch '+r['id'])
  require((len(actors)>1)==(r['shared']=='True'),'Sharing mismatch '+r['id'])
  require(all(r[x] for x in ('proposed_contract','request_fields','result','scope_variations_and_invariants','source_evidence')),'Incomplete contract '+r['id'])
 for m in masters:
  require(set(m['workflow_ids'].split(';'))=={r['id'] for r in workflows if r['master']==m['id']},'Module links '+m['id'])
 for p in read('personas.csv'):
  direct={r['id'] for r in workflows if p['persona'] in (r['personas']+'; '+r['conditional_personas']).split('; ')}
  require(direct==set(filter(None,p['workflow_ids'].split(';'))),'Persona links '+p['code'])
  require(len(direct)==int(p['workflow_count_including_conditional']),'Persona count '+p['code'])
  subjects={r['id'] for r in workflows if p['persona'] in r['managed_subjects'].split('; ')}
  require(subjects==set(filter(None,p['managed_subject_workflow_ids'].split(';'))),'Subject links '+p['code'])
 require(len(read('personas.csv'))==13,'Role coverage')
 for r in read('api-catalog.csv'):
  require(set(r['workflow_ids'].split(';'))<=ids,'Unknown API workflow '+r['contract'])
 coverage=json.loads((ROOT/'coverage.json').read_text())
 for name,count in coverage.items():
  if name.endswith('.csv'):require(len(read(name))==count,'Inventory count '+name)
 require(coverage['unclassified']==0,'Unclassified inventory')
 require(len(read('notification-events.csv'))==len({r['legacy_type'] for r in read('notification-events.csv')}),'Duplicate notification type')
 # Link/path checks cover local documentation, not inaccessible private GitHub permissions.
 docs=list(ROOT.glob('*.md'))+[ROOT.parent/'SQUAD_ONE_BACKEND_PLAN.md']
 matrix=(ROOT/'FUNCTIONALITY_MATRIX.md').read_text()
 for id in ids:require('### '+id+' —' in matrix,'Missing detailed contract '+id)
 for p in docs:
  s=p.read_text()
  for target in re.findall(r'\]\(([^)]+)\)',s):
   if target.startswith(('https://','http://','#')):continue
   require((p.parent/target.split('#')[0]).exists(),'Broken local link '+str(p)+': '+target)
  require(not re.search(r'sbp_[a-f0-9]{30,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}',s),'Potential credential in '+p.name)
 # Also inspect generated tables and HTML: no PAT/JWT/private-key body can be shipped.
 for p in list(ROOT.glob('*.csv'))+list(ROOT.glob('*.html')):
  s=p.read_text();require(not re.search(r'sbp_[a-f0-9]{30,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----',s),'Potential credential in '+p.name)
 # Test actual embedded filter code without adding product dependencies or running an app.
 script=re.search(r'<script>([\s\S]*)</script>',(ROOT/'matrix.html').read_text())[1]
 test='''const vm=require('node:vm');const assert=require('node:assert/strict');const els={};for(const k of ['#search','#persona','#shared','#count','#rows'])els[k]={value:'',textContent:'',innerHTML:'',addEventListener(){}};const document={querySelector:s=>els[s],querySelectorAll:()=>Object.values(els)};const context={document};vm.createContext(context);vm.runInContext(SOURCE,context);assert.equal((els['#rows'].innerHTML.match(/<tr>/g)||[]).length,COUNT);els['#persona'].value='Tailor';vm.runInContext('render()',context);assert.equal((els['#rows'].innerHTML.match(/<tr>/g)||[]).length,8);assert.ok(els['#rows'].innerHTML.includes('Managed subjects:'));els['#persona'].value='';els['#shared'].value='yes';vm.runInContext('render()',context);assert.equal((els['#rows'].innerHTML.match(/<tr>/g)||[]).length,SHARED);els['#shared'].value='';els['#search'].value='this-search-has-no-results';vm.runInContext('render()',context);assert.equal(els['#rows'].innerHTML,'');els['#search'].value='cutting';vm.runInContext('render()',context);assert.ok(els['#rows'].innerHTML.includes('Cutting'));'''.replace('SOURCE',json.dumps(script)).replace('COUNT',str(len(workflows))).replace('SHARED',str(coverage['shared_workflows']))
 subprocess.run(['node','-e',test],check=True,capture_output=True)
 acceptance=(ROOT/'ACCEPTANCE.md').read_text()
 require(all(re.search(r'\b'+m+r'\b',acceptance) for m in MODULES),'Missing module acceptance')
 cases=re.findall(r'^\| ([A-Z]+-\d+) \|',acceptance,re.M);require(len(cases)==len(set(cases)),'Duplicate acceptance case')
 result={'workflow_rows':len(workflows),'modules':len(MODULES),'stored_personas':13,'managed_subject_workflows':len(SUBJECTS),'future_acceptance_scenarios':len(cases),'inventory_unclassified':0,'local_links':'passed','credential_pattern_scan':'passed','matrix_filter_checks':'passed','visual_browser_review':'not performed; browser URL policy rejected file protocol','runtime_business_tests':'not run; services are planned'}
 (ROOT/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2))
if __name__=='__main__':main()
