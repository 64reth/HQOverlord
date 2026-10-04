// Apply only this reviewed room's finish/spacing to the owned custom demo save.
// The original station artifact is retained for reversal. Never targets installed user data.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const file='dev/.scratch-workspace/agent.save.json';
const before=JSON.parse(readFileSync('.worldshots/command-room/original-station.json','utf8'));
const after=JSON.parse(readFileSync('.worldshots/command-room/proposed-station.json','utf8'));
const envelope=JSON.parse(readFileSync(file,'utf8'));
const asString=typeof envelope.doc==='string';const doc=asString?JSON.parse(envelope.doc):envelope.doc;
const current=doc.station;
for(const key of ['floorMat','floorPaint','hullMat','hullStyle']){
  if(JSON.stringify(current.rooms.r1[key])===JSON.stringify(after.rooms.r1[key]))continue;
  assert.deepEqual(current.rooms.r1[key],before.rooms.r1[key],'Command room changed since the review: '+key);
  current.rooms.r1[key]=after.rooms.r1[key];
}
for(const p of after.props){
  const old=before.props.find(o=>o.id===p.id);if(!old||(old.x===p.x&&old.y===p.y))continue;
  const target=current.props.find(o=>o.id===p.id);assert.ok(target,'Equipment still exists: '+p.id);
  if(target.x===p.x&&target.y===p.y)continue;
  assert.deepEqual([target.x,target.y],[old.x,old.y],'Equipment moved since review: '+p.id);
  target.x=p.x;target.y=p.y;
}
const stamp=old=>typeof old==='string'?new Date().toISOString():Date.now();
current.updatedAt=stamp(current.updatedAt);doc.updatedAt=stamp(doc.updatedAt);
envelope.doc=asString?JSON.stringify(doc):doc;envelope.updatedAt=stamp(envelope.updatedAt);envelope.savedAt=stamp(envelope.savedAt);
writeFileSync(file+'.command.tmp',JSON.stringify(envelope),'utf8');renameSync(file+'.command.tmp',file);
console.log('Applied the reviewed command room to the owned custom demo; all other save fields preserved.');
