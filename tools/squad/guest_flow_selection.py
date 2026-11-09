"""Browser acceptance selection never narrows the owned fixture cleanup graph."""
KINDS=('register','confirm','recovery','invite')

def requested_flows(value=None):
    if value is None:return list(KINDS)
    values=value.split(',') if isinstance(value,str) else value
    assert isinstance(values,(list,tuple)) and values,'Choose at least one guest flow'
    assert all(type(v) is str and v in KINDS for v in values),'Unknown guest flow'
    assert len(values)==len(set(values)),'Duplicate guest flow'
    return [kind for kind in KINDS if kind in values]

def checkpoint_selection(state):
    selected=state.get('requested_flows')
    assert type(selected) is list and selected==requested_flows(selected),'Invalid checkpoint guest selection'
    return tuple(selected)

def completed_selection(state,results):
    selected=checkpoint_selection(state)
    assert isinstance(results,list) and tuple(r.get('kind') for r in results)==selected,'Browser did not complete exactly the selected guest flows'
    for result in results:
        assert result.get('requestId')==state['flows'][result['kind']]['id'],'Guest completion belongs to another flow'
    return {'requested_flows':list(selected),'untested_flows':[kind for kind in KINDS if kind not in selected],
            'all_flows_passed':selected==KINDS}
