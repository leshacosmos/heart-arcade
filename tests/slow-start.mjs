import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../cabinet.js',import.meta.url),'utf8');
const pending=[];
const elements=new Map();
const el=id=>{
  if(!elements.has(id))elements.set(id,{open:false});
  return elements.get(id);
};
let renders=0;
const context=vm.createContext({
  el,window:{addEventListener(){}},document:{addEventListener(){},hidden:false},
  setInterval(){},localApi(){return new Promise(()=>{})},isLocal:true,isDemo:false,
  client:null,state:{},rewards:[],snapshot(){return new Promise((resolve,reject)=>pending.push({resolve,reject}))},
  render(){renders++}
});
vm.runInContext(source,context);
const run=code=>vm.runInContext(code,context);
run("activeUser='fixture'");
const snapshot={role:'player',rewards:[],quests:[],events:[],coupons:[]};

// A timer and a focus event can both arrive before the first snapshot returns.
const first=run('refresh(true)');
const tick=run('sync()'),focus=run('sync()');
assert.equal(pending.length,1,'background reads superseded a slow initial read');
pending.shift().resolve(snapshot);
await Promise.all([first,tick,focus]);
assert.equal(renders,1);

// A connection error releases the guard, so the next refresh can succeed.
const failed=run('sync()');
pending.shift().reject(new Error('offline'));
await failed;
const next=run('sync()');
assert.equal(pending.length,1);
pending.shift().resolve({...snapshot,events:[{delta:3}]});
await next;
assert.equal(renders,2);
console.log('PASS: slow opening, overlapping refreshes, network recovery');
