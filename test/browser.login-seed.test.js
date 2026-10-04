/* node test/browser.login-seed.test.js - keep the live attended-login proof floor-real. */
'use strict';
const A = require('./_assert.js');
const { ensureLoginStation } = require('../dev/seed-mock-login.js');

{
  const save = { doc: { station: null } };
  ensureLoginStation(save);
  const station = save.doc.station;
  const dish = station.props.find(prop => prop.t === 'comms_dish');
  A.eq(station.schema, 'starnet.station', 'a null golden station becomes a valid persisted station document');
  A.ok(station.rooms.r1 && station.order[0] === 'r1', 'the proof station carries the starter room topology');
  A.eq({ t: dish.t, w: dish.w, h: dish.h }, { t: 'comms_dish', w: 2, h: 2 }, 'the proof grants web with the real comms_dish prop');
}

{
  const station = { _nid: 10, props: [{ id: 'p2', t: 'desk' }] };
  const save = { doc: { station } };
  ensureLoginStation(save);
  A.eq(station.props[1].id, 'p10', 'an existing station receives a collision-safe persisted prop id');
  A.eq(station._nid, 11, 'the station id counter advances with the inserted dish');
  ensureLoginStation(save);
  A.eq(station.props.filter(prop => prop.t === 'comms_dish').length, 1, 'seeding is idempotent');
}

{
  const save = {};
  A.eq(ensureLoginStation(save), save, 'a malformed fixture is left untouched instead of fabricating a save document');
}

A.report('browser.login-seed.test');
