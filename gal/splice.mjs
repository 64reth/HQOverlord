// node gal/splice.mjs <bundle.js> — splice a bundle of `F.<id> = (...) => { ... };` blocks (plus any
// leading kit code before the first F.) into frontend/app/propsprites.js, replacing each existing
// F.<id> block. A block terminates at the function's OWN `\n  };` (never at the next F. — a module
// const between two props would otherwise be eaten). Kit code is inserted before the first replaced prop.
import { readFileSync, writeFileSync } from 'node:fs';
const [bundlePath] = process.argv.slice(2);
const FILE = 'frontend/app/propsprites.js';
let src = readFileSync(FILE, 'utf8');
const bundle = readFileSync(bundlePath, 'utf8');
const RE = /^  F\.([A-Za-z0-9_]+) = \((?:[^)]*)\) => \{$/m;
const firstF = bundle.search(RE);
const kit = firstF > 0 ? bundle.slice(0, firstF) : '';
const rest = bundle.slice(Math.max(0, firstF));
const blocks = [];
const parts = rest.split(/^(?=  F\.[A-Za-z0-9_]+ = )/m).filter(s => s.trim());
for (const p of parts) {
  const m = p.match(/^  F\.([A-Za-z0-9_]+) = /); if (!m) throw new Error('bad block ' + p.slice(0, 40));
  const end = p.indexOf('\n  };'); if (end < 0) throw new Error('no terminator in ' + m[1]);
  blocks.push({ id: m[1], text: p.slice(0, end + 5) });
}
let kitDone = !kit.trim();
for (const b of blocks) {
  const start = src.indexOf('\n  F.' + b.id + ' = (');
  if (start < 0) throw new Error('F.' + b.id + ' not found in ' + FILE);
  const end = src.indexOf('\n  };', start);
  if (end < 0) throw new Error('no terminator for F.' + b.id);
  const before = src.slice(0, start + 1), after = src.slice(end + 5);
  src = before + (kitDone ? '' : kit) + b.text + after;
  kitDone = true;
  console.log('spliced F.' + b.id);
}
writeFileSync(FILE, src);
