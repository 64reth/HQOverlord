/* node test/comms-history-pin.test.js — a switched-to transcript receives one final post-layout
   bottom pin, while a real reader gesture cancels it and ordinary sticky/new-message behavior survives. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');

A.ok(/let historyPinSeq = 0, historyPinPending = 0/.test(src),
  'history loads own a distinct pending bottom-pin token');
A.ok(/function pinLoadedHistoryAfterLayout\(seq\)[\s\S]{0,900}requestAnimationFrame\(\(\) => requestAnimationFrame\(pin\)\)/.test(src),
  'history pin waits through two rendered frames before measuring final scrollHeight');
A.ok(/historyPinPending !== seq[\s\S]{0,180}log\.scrollTop = log\.scrollHeight[\s\S]{0,180}historyPinPending = 0/.test(src),
  'only the latest load can perform the final pin and it retires its token afterward');
A.ok(/\['wheel', 'touchstart', 'pointerdown'\][\s\S]{0,180}cancelHistoryPin/.test(src),
  'wheel, touch, and scrollbar/pointer intent cancel the pending automatic pin');
A.ok(/log\.addEventListener\('scroll'[\s\S]{0,180}if \(historyPinPending\) return[\s\S]{0,240}stick = nearBottom\(\)/.test(src),
  'programmatic replay scroll events cannot falsely disable stick, while ordinary scrolls still update it');
const loadBody = src.match(/function load\(ws\) \{([\s\S]*?)\n  \}/)?.[1] || '';
A.ok(/const historyPin = \+\+historyPinSeq[\s\S]*renderHistory\(\)[\s\S]*replayChannel\(\)[\s\S]*pinLoadedHistoryAfterLayout\(historyPin\)/.test(loadBody),
  'every load schedules its final pin only after history and in-flight replay surfaces render');

A.report('comms-history-pin.test');
