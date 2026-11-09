import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createBrowserShutdownGuard,BrowserShutdownUnconfirmed} from './browser-shutdown-guard.mjs';
test('normal completion closes once and removes only own signal listeners',async()=>{
 const signals=new EventEmitter(),existing=()=>{};signals.on('SIGTERM',existing);let closed=0;
 const guard=createBrowserShutdownGuard({close:async()=>{closed++;}},{deadlineMs:20,signals});
 guard.assertActive();await guard.dispose();await guard.dispose();await delay(30);
 assert.equal(closed,1);assert.equal(guard.reason,null);assert.deepEqual(signals.listeners('SIGTERM'),[existing]);assert.equal(signals.listenerCount('SIGINT'),0);
});
test('deadline closes browser to interrupt pending browser work, forbids success and cleans hooks',async()=>{
 const signals=new EventEmitter();let closed=0;
 const guard=createBrowserShutdownGuard({close:async()=>{closed++;}},{deadlineMs:5,signals});
 await delay(15);assert.equal(guard.reason,'deadline');assert.throws(()=>guard.assertActive(),/deadline/);await guard.dispose();
 assert.equal(closed,1);assert.equal(signals.listenerCount('SIGTERM'),0);
});
test('both termination signals share one shutdown and never turn interruption into success',async()=>{
 const signals=new EventEmitter();let closed=0;
 const guard=createBrowserShutdownGuard({close:async()=>{closed++;await delay(5);}},{deadlineMs:1000,signals});
 signals.emit('SIGTERM');signals.emit('SIGINT');assert.throws(()=>guard.assertActive(),/interrupted/);await guard.dispose();assert.equal(closed,1);
});
test('browser shutdown refusal remains a failure for the parent checkpoint',async()=>{
 const signals=new EventEmitter();const guard=createBrowserShutdownGuard({close:async()=>{throw new Error('closed refused');}},{deadlineMs:1000,signals});
 signals.emit('SIGTERM');await assert.rejects(guard.dispose(),BrowserShutdownUnconfirmed);assert.equal(signals.listenerCount('SIGINT'),0);
});
