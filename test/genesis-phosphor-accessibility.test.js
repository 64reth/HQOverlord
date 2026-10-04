/* node test/genesis-phosphor-accessibility.test.js — execute the production Genesis phosphor picker
   against a minimal DOM and prove its accessible selection follows the same state as `.sel`. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
const start = src.indexOf('const PHOSPHOR =');
const end = src.indexOf('// THE APPROVAL PICKER', start);
A.ok(start >= 0 && end > start, 'the Genesis phosphor picker production segment exists');

function tokens(value) { return String(value || '').split(/\s+/).filter(Boolean); }
function classList(owner) {
  return {
    add(...names) { owner.className = [...new Set(tokens(owner.className).concat(names))].join(' '); },
    remove(...names) { owner.className = tokens(owner.className).filter(x => !names.includes(x)).join(' '); },
    toggle(name, force) {
      const set = new Set(tokens(owner.className));
      const on = force === undefined ? !set.has(name) : !!force;
      if (on) set.add(name); else set.delete(name);
      owner.className = [...set].join(' ');
      return on;
    }
  };
}
function button() {
  const attrs = Object.create(null);
  const b = {
    className: '', dataset: {}, style: { setProperty() {} },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; }
  };
  b.classList = classList(b);
  return b;
}

const wrap = {
  children: [],
  set innerHTML(v) { if (v === '') this.children.length = 0; },
  appendChild(child) { this.children.push(child); return child; }
};
const body = { className: 'theme-amber' };
body.classList = classList(body);
const document = {
  body,
  getElementById(id) { return id === 'phosphor-swatches' ? wrap : null; },
  createElement(tag) { A.eq(tag, 'button', 'the picker creates only button controls'); return button(); }
};
let savedTheme = '', clicks = 0;
const StationUI = { getTheme: () => 'amber', setTheme: t => { savedTheme = t; } };
const SFX = { click: () => { clicks++; } };
const picker = Function('document', 'StationUI', 'SFX',
  "'use strict'; const el = id => document.getElementById(id);\n" + src.slice(start, end) + '\nreturn { buildPhosphor };'
)(document, StationUI, SFX);

picker.buildPhosphor();
A.eq(wrap.children.length, 6, 'all six phosphor choices render');
A.eq(wrap.children.map(b => b.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'false', 'false'],
  'the saved amber tint initializes as the one accessible selection');
A.eq(wrap.children.filter(b => b.className.split(/\s+/).includes('sel')).length, 1,
  'the visual picker also initializes with one selection');

const green = wrap.children.find(b => b.dataset.t === 'green');
A.ok(green && typeof green.onclick === 'function', 'the green phosphor choice is interactive');
green.onclick();
A.eq(savedTheme, 'green', 'selection still persists through StationUI');
A.ok(body.className.includes('theme-green'), 'selection still recolors the live screen');
A.eq(clicks, 1, 'selection still emits one station click');
A.eq(wrap.children.map(b => b.getAttribute('aria-pressed')), ['false', 'true', 'false', 'false', 'false', 'false'],
  'accessible selection moves to green with the visual selection');
A.eq(wrap.children.filter(b => b.className.split(/\s+/).includes('sel')).map(b => b.dataset.t), ['green'],
  'exactly the same green choice remains visually selected');

A.report('genesis-phosphor-accessibility.test');
