/* STARNET — windows/rewind.js : the RESTORE lane of the AGENT DOSSIER (was the RESTORE POINTS window).
   NAV CONDENSE 2 (2026-08-04): restore points are agent-scoped, so they live in the dossier — this
   file registers a DossierLane ((body)=>({sections,wire})) that stationui's buildAgents mounts as a
   RESTORE section. The dossier roster rail drives agent switching (the lane reads H.present/H.sel
   on every rebuild), so the old in-window roster switcher is gone. */
'use strict';
(() => {
  if (typeof StationUI === 'undefined' || !StationUI.h) return;
  const H = StationUI.h;
  const esc = H.esc, sfx = H.sfx, fmtRel = H.fmtRel, notify = H.notify;

  /* ============== REWIND — restore points (the execution-spine checkpoint net) ==============
     Every command an agent runs auto-saves a workspace snapshot FIRST; this lists them per agent and
     restores one with a two-step confirm. Server-owned (GET/POST /api/checkpoint); honest — only real
     snapshots show, and it says plainly when there are none yet. */
  function rewindLane(body) {
    const a = H.present[H.sel] || {};   // live core state via the h getters
    const agentId = a.id || 'agent';
    const nm = a.name || agentId;   // display NAME, never the raw id
    const secRestore =
      '<p class="set-about">A snapshot of the exact workspace or authorized project <b>' + esc(nm) + '</b> is changing is auto-saved <b>before every command it runs</b> ' +
      '(and before file edits when checkpoints are on). Restoring rolls that named root back and removes anything ' +
      'created since. <span class="dim">Use it to undo a bad change.</span></p>' +
      // 9px of top margin: the paragraph above ends on a dim trailing clause and the button sat hard against it,
      // which read as the two being one wrapped line rather than prose followed by a control.
      '<div class="mc-acts" style="margin:9px 0 8px"><button class="bb xs" id="rw-refresh" title="re-read this agent\'s restore points">↻ REFRESH</button></div>' +
      '<div id="rw-list" class="mc-list"><span class="loading pulse">loading…</span></div>' +
      '<div id="rw-msg" class="msg"></div>';
    const sections = [
      { id: 'restore', label: 'RESTORE', glyph: '↶', desc: 'Workspace restore points for ' + nm + ' — roll back to before a bad change.',
        build: (el => { el.innerHTML = secRestore; }) }
    ];
    function wire() {
    const listEl = body.querySelector('#rw-list'), msgEl = body.querySelector('#rw-msg');
    function row(s) {
      const when = s.ts ? esc(fmtRel(new Date(s.ts).toISOString())) : '';
      const target = s.workTree ? String(s.workTree) : (nm + '\'s agent workspace');
      const targetKind = s.workTree ? 'PROJECT ROOT' : 'AGENT WORKSPACE';
      const available = s.restoreAvailable !== false;
      return '<div class="mc-row" data-id="' + esc(s.id) + '" data-when="' + when + '" data-root="' + esc(target) + '">' +
        '<div class="mc-top"><b>' + esc(s.label || 'snapshot') + '</b> <span class="dim">' + when + '</span></div>' +
        '<div class="mc-url"><b>' + targetKind + '</b> · ' + esc(target) + '</div>' +
        '<div class="mc-url dim">' + esc(String(s.id).slice(0, 12)) + ' · turn ' + (s.turn || 0) + (s.files ? (' · ' + s.files + ' file' + (s.files === 1 ? '' : 's')) : '') + '</div>' +
        '<div class="mc-acts">' + (available
          ? '<button class="bb xs danger" data-act="restore">↶ RESTORE</button>'
          : '<span class="dim">PROJECT ACCESS REVOKED · REAUTHORIZE THIS ROOT TO RESTORE</span>') + '</div>' +
        '</div>';
    }
    async function refresh() {
      try {
        const j = await Harness.api.get('/api/checkpoint?agent=' + encodeURIComponent(agentId));
        const snaps = ((j && j.snapshots) || []).slice().reverse();   // newest first
        // honest empty-state: file-edit snapshots are opt-in (SKYNET_CHECKPOINTS); shell commands ALWAYS snapshot.
        // Tell the user what actually triggers a restore point under their current config, not an aspirational promise.
        const empty = (j && j.enabled)
          ? 'NO RESTORE POINTS YET.<br><span>They appear once this agent runs a command or edits a file at a WORKBENCH.</span>'
          : 'NO RESTORE POINTS YET.<br><span>They appear once this agent runs a <b>shell command</b>. File-edit snapshots aren\'t enabled on this station.</span>';
        listEl.innerHTML = snaps.length ? snaps.map(row).join('') : '<div class="fb-empty">' + empty + '</div>';
      } catch (_) { listEl.innerHTML = '<div class="mc-detail">sidecar offline — start it to manage restore points.</div>'; }
    }
    let armTimer = 0;
    listEl.addEventListener('click', async ev => {
      const btn = ev.target.closest('button[data-act="restore"]'); if (!btn) return;
      const rowEl = ev.target.closest('.mc-row'); const id = rowEl && rowEl.dataset.id; if (!id) return;
      if (!btn.dataset.armed) {
        // arm + STATE THE STAKES: name what a restore removes (everything created since this point's time).
        btn.dataset.armed = '1'; btn.textContent = '↶ CONFIRM'; sfx('bad');
        const when = rowEl.dataset.when || 'this point';
        const root = rowEl.dataset.root || (nm + '\'s agent workspace');
        msgEl.className = 'msg'; msgEl.innerHTML = '<span class="dim">rolls back <b>' + esc(root) + '</b> and removes anything created there since <b>' + esc(when) + '</b> — CONFIRM to continue</span>';
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = '↶ RESTORE'; msgEl.innerHTML = ''; } }, 5000);
        return;
      }
      clearTimeout(armTimer); delete btn.dataset.armed;
      sfx('bad'); btn.disabled = true; msgEl.className = 'msg'; msgEl.textContent = 'restoring…';
      try {
        const r = (await Harness.api.post('/api/checkpoint/restore', { agentId: agentId, snapshotId: id })).j;
        if (r && r.ok) { notify('restored ' + (rowEl.dataset.root || nm + '\'s workspace') + ' to an earlier point', 'warn'); msgEl.className = 'msg ok'; msgEl.textContent = '✓ restored.'; }
        else { msgEl.innerHTML = '<span style="color:var(--bad)">✕ ' + esc((r && r.error) || 'restore failed') + '</span>'; sfx('bad'); }
      } catch (e) { msgEl.innerHTML = '<span style="color:var(--bad)">✕ ' + esc((e && e.message) || 'restore failed') + '</span>'; sfx('bad'); }
      btn.disabled = false; refresh();
    });
    const refreshBtn = body.querySelector('#rw-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => { sfx('click'); listEl.innerHTML = '<span class="loading pulse">loading…</span>'; refresh(); });
    refresh();
    }

    return { sections, wire };
  }

  window.DossierLanes = window.DossierLanes || [];
  window.DossierLanes.push(rewindLane);
})();
