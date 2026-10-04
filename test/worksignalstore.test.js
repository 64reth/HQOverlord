'use strict';
const A = require('./_assert.js');
global.WorkSignal = require('../frontend/app/worksignal.js');
const bus = A.makeBus();
global.U = { bus };
global.ToolProps = { toolPropType: name => name.indexOf('web.') === 0 ? 'dish' : name.indexOf('fs.') === 0 ? 'cabinet' : null };
const { WorkSignalStore } = require('../frontend/app/worksignalstore.js');

let saves = 0, learning = true;
WorkSignalStore.init({ signal: WorkSignal.fresh(), persist: () => { saves++; }, learningOn: () => learning, getRunTag: () => 'research' });
A.eq(bus._h['agent.tool_call'].length, 1, 'store subscribes once to tool activity');
A.eq(bus._h['agent.run.end'].length, 1, 'store subscribes once to completed-run outcomes');

bus.emit('agent.tool_call', { runId: 'r1', name: 'web.search' });
bus.emit('agent.tool_call', { runId: 'r1', name: 'web.search' });
bus.emit('agent.tool_call', { runId: 'r1', name: 'fs.read' });
A.eq(WorkSignalStore.summary().samples, 0, 'tool calls accumulate lanes but do not count as recommendation samples');
bus.emit('agent.run.end', { runId: 'r1', reason: 'done' });
A.eq(WorkSignalStore.summary().samples, 1, 'a completed run folds exactly one sample');
A.eq(WorkSignalStore.model().lanes.dish.n, 1, 'repeated calls in one lane collapse to one lane observation');
A.eq(WorkSignalStore.model().lanes.cabinet.n, 1, 'a second lane in the run is preserved');
A.eq(saves, 1, 'the normalized run fold persists once');

bus.emit('agent.tool_call', { runId: 'r2', name: 'web.search' });
bus.emit('agent.run.end', { runId: 'r2', reason: 'error' });
A.eq(WorkSignalStore.summary().samples, 1, 'failed runs do not train workflow recommendations');
learning = false;
bus.emit('agent.tool_call', { runId: 'r3', name: 'web.search' });
bus.emit('agent.run.end', { runId: 'r3', reason: 'done' });
A.eq(WorkSignalStore.summary().samples, 1, 'the learning switch blocks the completed-run fold');
A.eq(WorkSignalStore._pending.size, 0, 'every terminal run clears pending raw activity');

A.report('worksignalstore.test');
