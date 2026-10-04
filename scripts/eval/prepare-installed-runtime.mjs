#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[String(argv[i] || '').replace(/^--/, '')] = argv[i + 1];
  return out;
}

function retarget(value, model, provider) {
  if (Array.isArray(value)) return value.map(item => retarget(item, model, provider));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'model' && typeof item === 'string') out[key] = model;
    else if ((key === 'provider' || key === 'providerId') && typeof item === 'string') out[key] = provider;
    else out[key] = retarget(item, model, provider);
  }
  return out;
}

const opts = argsOf(process.argv.slice(2));
if (opts.cleanup === '1') {
  if (!opts.destination) throw new Error('cleanup requires --destination');
  const destination = resolve(opts.destination);
  for (const relative of [join('codex', 'tokens.json'), 'auth.json', '.env']) {
    const target = resolve(destination, relative);
    if (target !== destination && !target.startsWith(destination + '\\') && !target.startsWith(destination + '/')) throw new Error('cleanup target escaped destination');
    rmSync(target, { force: true });
  }
  console.log('[agent-eval] copied credential files removed from isolated evaluation home');
  process.exit(0);
}
if (!opts.source || !opts.destination || !opts.model || !opts.provider) throw new Error('requires --source, --destination, --model, and --provider');
const source = resolve(opts.source), destination = resolve(opts.destination);
for (const name of ['agent.roster.json', 'agent.save.json']) {
  const parsed = JSON.parse(readFileSync(join(source, name), 'utf8'));
  const output = join(destination, name);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(retarget(parsed, opts.model, opts.provider), null, 2) + '\n', 'utf8');
}
console.log(`[agent-eval] isolated StarNet runtime prepared with ${opts.provider}/${opts.model}; credentials were not copied`);
