/* node test/modelpicker.test.js — ModelPicker value-encoding: the shared per-agent model chooser encodes BOTH
   provider AND id into each <option> value, so a chosen model can never desync from its provider (the correctness
   guarantee the recruitment bay + dossier both depend on). Pure logic — read()/shellHTML tested with a fake root,
   no DOM/ModelDock needed (both are typeof-guarded in the module). */
'use strict';
const A = require('./_assert.js');
const MP = require('../frontend/app/modelpicker.js');

// a minimal stand-in for the mounted control: querySelector returns fake <select>s with .value set.
function fakeRoot(modelVal, effortVal) {
  return {
    querySelector: (sel) => {
      if (sel === '.mp-model') return { value: modelVal };
      if (sel === '.mp-effort') return (effortVal === undefined) ? null : { value: effortVal };
      return null;
    }
  };
}

// ---- read(): split provider|id, honour inherit + sentinel values ----
{
  let r = MP.read(fakeRoot('anthropic|claude-opus-4.8'));
  A.eq(r.provider, 'anthropic', 'provider is decoded from the option value');
  A.eq(r.model, 'claude-opus-4.8', 'model id is decoded from the option value');

  r = MP.read(fakeRoot('openrouter|anthropic/claude-opus-4.8'));
  A.eq(r.provider, 'openrouter', 'the FIRST delimiter splits provider from id');
  A.eq(r.model, 'anthropic/claude-opus-4.8', 'a slashed model id survives intact (never eaten by the split)');

  r = MP.read(fakeRoot(''));
  A.eq(r.model, '', 'the inherit option yields an empty model (a deliberate clear)');
  A.eq(r.provider, '', 'inherit yields an empty provider too');

  A.eq(MP.read(fakeRoot('__loading')).model, '', 'the loading placeholder never reads as a model');
  A.eq(MP.read(fakeRoot('__none')).model, '', 'the empty-catalog placeholder never reads as a model');

  r = MP.read(fakeRoot('bare-model-with-no-provider'));
  A.eq(r.model, 'bare-model-with-no-provider', 'a value with no delimiter is treated as a bare model id');
  A.eq(r.provider, '', 'a bare model id carries no provider');
}

// ---- read(): effort select is optional + read when present ----
{
  A.eq(MP.read(fakeRoot('codex|gpt-5.3-codex')).effort, '', 'no effort select → empty effort');
  A.eq(MP.read(fakeRoot('codex|gpt-5.3-codex', 'high')).effort, 'high', 'effort is read from the effort select when present');
}

// ---- shellHTML(): renders the model select always, the effort select only when asked ----
{
  const withEffort = MP.shellHTML({ id: 'x', inheritLabel: 'Follow station default', effort: true });
  A.ok(/class="mp-model"/.test(withEffort), 'shellHTML renders the model <select>');
  A.ok(/id="x-model"/.test(withEffort), 'the model select id is prefixed by the given id');
  A.ok(/class="mp-effort"/.test(withEffort), 'effort:true renders the effort <select>');
  A.ok(/Follow station default/.test(withEffort), 'the inherit option label is rendered');

  const noEffort = MP.shellHTML({ id: 'y' });
  A.ok(/class="mp-model"/.test(noEffort), 'the model select renders without an effort select too');
  A.ok(!/class="mp-effort"/.test(noEffort), 'no effort select unless effort:true');
}

A.report('modelpicker.test');
