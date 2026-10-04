'use strict';
const A = require('./_assert.js');
const Settings = require('../sidecar/execution-settings.js');

const base = Settings.normalize(null, { idleCleanupMinutes: 45 });
A.eq(base.idleCleanupMinutes, 45, 'configured idle default is retained');
A.eq(Object.keys(base.sshTargets).length, 0, 'cold settings contain no invented SSH target');

const withTarget = Settings.setTarget(base, 'agent_1', { host: 'buildbox', user: 'andrew', port: 2222, remoteRoot: '/srv/starnet/agent_1', password: 'must-not-persist', privateKey: 'must-not-persist' });
const target = Settings.targetFor(withTarget, 'agent_1');
A.eq(target.host, 'buildbox', 'SSH host persists');
A.eq(target.user, 'andrew', 'SSH user persists');
A.eq(target.port, 2222, 'SSH port persists');
A.eq(target.remoteRoot, '/srv/starnet/agent_1', 'remote workspace persists');
A.eq(target.password, undefined, 'password is not part of the durable execution schema');
A.eq(target.privateKey, undefined, 'private keys are never stored in execution settings');

A.throws(() => Settings.normalizeTarget({ host: '-oProxyCommand=evil', remoteRoot: '/workspace' }), 'option-shaped SSH hosts are rejected');
A.throws(() => Settings.normalizeTarget({ host: 'buildbox', remoteRoot: '/../etc' }), 'remote parent traversal is rejected');
A.throws(() => Settings.normalizeTarget({ host: 'buildbox', remoteRoot: '/workspace with spaces' }), 'ambiguous scp remote paths are rejected');

const disabled = Settings.setIdleCleanupMinutes(withTarget, 0);
A.eq(disabled.idleCleanupMinutes, 0, 'zero explicitly disables automatic idle cleanup');
const capped = Settings.setIdleCleanupMinutes(disabled, 9000);
A.eq(capped.idleCleanupMinutes, 1440, 'idle cleanup is bounded to one day');
const cleared = Settings.setTarget(capped, 'agent_1', {});
A.eq(Settings.targetFor(cleared, 'agent_1').configured, false, 'owner can clear a saved SSH target');

A.report('execution-settings.test');
