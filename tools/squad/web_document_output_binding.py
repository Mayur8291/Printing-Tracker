"""Browser-request binding adapter for existing exact document recovery.

document_output_recovery.bindings dispatches here only when
state['web_output_rehearsal'] is True. All registration, immutable worker receipt,
lease, Storage and cleanup checks remain the existing reviewed implementation.
This module never registers jobs, changes state, reads secrets, or calls HTTP.
"""
import re
import uuid
import test_hosted_business_journeys as business

KINDS={'delivery_challan':7,'tailor_weekly':4}


def bindings(c,state):
    business.validate(state)
    assert state.get('web_output_rehearsal') is True,'Expected explicit browser output rehearsal'
    run=uuid.UUID(state['run_id'])
    requests=state.get('web_document_output_requests')
    assert isinstance(requests,list) and len(requests)==2,'Exactly weekly and challan requests are required'
    assert {r.get('kind') for r in requests}==set(KINDS)
    assert len({r.get('document_id') for r in requests})==2
    actors={a['role']:a for a in state['identity']['actors']}
    keys={}
    for entry in business.journal(state):
        if entry.get('kind')!='command':continue
        value=entry.get('value',{});label=value.get('label','')
        match=re.fullmatch(r'web\.role(4|7)\.([0-9]{1,3})',label)
        if not match:continue
        assert 0<=int(match[2])<256,'Browser command exceeds fixed journal window'
        key=str(uuid.UUID(value['key']))
        assert uuid.UUID(key)==uuid.uuid5(run,label),'Browser command key differs from deterministic journal'
        if key in keys:assert keys[key]==int(match[1])
        keys[key]=int(match[1])
    result=[]
    for request in sorted(requests,key=lambda r:r['kind']):
        assert set(request)=={'document_id','kind','role'}
        kind=request['kind'];role=KINDS[kind];assert request['role']==role
        document_id=str(uuid.UUID(request['document_id']));actor=actors[role]
        rows=c.execute("""SELECT to_jsonb(d),j.command_key::text,
          encode(sha256(convert_to(jsonb_build_object('kind',d.kind,'request',d.request,'actor_id',d.actor_id,'generation',d.generation)::text,'UTF8')),'hex')
          FROM sa_domain.documents d JOIN sa_domain.outbox j ON j.id=d.job_id
          JOIN sa_domain.audit a ON a.actor_id=d.actor_id AND a.command_key=j.command_key
          WHERE d.id=%s AND d.actor_id=%s AND a.operation='document.requested' AND a.kind='document'
            AND a.entity_id=d.sequence_id AND a.generation=d.generation
            AND a.changes=jsonb_build_object('document_id',d.id)
            AND j.actor_id=d.actor_id AND j.generation=d.generation
            AND j.event_type='document.requested' AND j.aggregate_kind='document' AND j.aggregate_id=d.sequence_id
            AND j.payload=jsonb_build_object('document_id',d.id)""",(document_id,actor['auth_id'])).fetchall()
        assert len(rows)==1,'Exact browser document request audit is unavailable'
        d,key,digest=rows[0]
        assert keys.get(key)==role,'Document request is not an owned browser command'
        assert d['kind']==kind and d['role_id']==role and d['legacy_user_id']==int(actor['id'])
        assert d['actor_id']==actor['auth_id'] and d['generation']==state['identity']['generation']
        assert d['request']['delivery']=='download' and d['delivery_state']=='not_requested'
        result.append({'document_id':d['id'],'job_id':d['job_id'],'actor_id':d['actor_id'],
          'generation':d['generation'],'kind':kind,'role':role,'request_hash':digest,
          'prefix':f"g{d['generation']}/{d['actor_id']}/{d['id']}/"})
    return result
