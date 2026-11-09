"""Accept only the bounded child diagnostic contract; never persist raw errors."""
import json
from pathlib import Path

CONTRACT=json.loads(Path(__file__).with_name('guest-diagnostic-contract.json').read_text())

def validate_diagnostic(value):
    assert isinstance(value,dict) and set(value)=={'format','kind','stage','type','code','frames'}
    assert value['format']=='squad-guest-failure/v1'
    assert value['kind'] is None or value['kind'] in ('register','confirm','recovery','invite')
    assert value['stage'] in CONTRACT['stages'] and value['type'] in CONTRACT['types']
    assert value['code'] is None or value['code'] in CONTRACT['codes']
    assert isinstance(value['frames'],list) and len(value['frames'])<=8
    for frame in value['frames']:
        assert isinstance(frame,dict) and set(frame)=={'file','line','column'}
        assert frame['file'] in CONTRACT['files']
        assert all(type(frame[k]) is int and 0<=frame[k]<=9999999 for k in ('line','column'))
    return value
