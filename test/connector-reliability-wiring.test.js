'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const rust = read('src-tauri/src/main.rs') + '\n' + read('src-tauri/src/credentials.rs');
const host = read('sidecar/index.js');
const harness = read('frontend/app/harness.js');
const settings = read('frontend/app/stationui.js');
const connectors = read('frontend/app/windows/connectors.js');

A.ok(/\("custom",\s*"SKYNET_CUSTOM_OPENAI_KEY"\)/.test(rust), 'desktop restart injects the custom-provider key');
A.ok(/for provider in KEYCHAIN_PROVIDERS[\s\S]{0,500}SKYNET_KEY_POOL_/.test(rust), 'desktop restart injects every provider-scoped backup pool');
A.ok(/fn post_sidecar_json[\s\S]*MAX_RESPONSE_HEAD[\s\S]*parse_sidecar_status/.test(rust), 'desktop provider mutations share a bounded, complete HTTP acknowledgement seam');
A.ok(/fn harness_store_provider_key_pool[\s\S]*rollback_error\(e, failures\)/.test(rust), 'desktop pool replacement reports incomplete rollback on live-push failure');
A.eq((rust.match(/let _ = push_provider_(?:config|key_pool)/g) || []).length, 0, 'provider rollback acknowledgement failures are never swallowed');
A.ok(/async function validateAndSetKey[\s\S]{0,1000}providers\/validate[\s\S]{0,1000}setKey\(candidate/.test(harness), 'candidate key is probed before persistence');
A.ok(/previous key is unchanged/.test(harness), 'rejected key replacement reports the preserved old credential');
A.ok(/validateAndSetKeyPool/.test(settings) && /restore the prior pool or report an incomplete rollback/.test(settings), 'Settings describes the provider-pool rollback boundary truthfully');
A.ok(/KEY_POOL_' \+ id\.toUpperCase/.test(host), 'runtime pool environment lookup includes the provider id');
A.eq(/ENV\('KEY_POOL'\)/.test(host), false, 'global cross-provider key pool is no longer consumed');
A.ok(/connectorOauthAttempts/.test(host) && /oauth\/cancel/.test(connectors), 'OAuth cancellation reaches both UI and backend discovery');
A.ok(/state\.json/.test(host) && /saveJsonVerified/.test(host), 'connector config and OAuth state share a read-back-verified durable envelope');
A.ok(/clientSecret: clientSecret, tokenEndpointAuthMethod: tokenEndpointAuthMethod/.test(host)
  && /clientSecret: pending\.clientSecret/.test(host) && /clientSecret: cur\.clientSecret/.test(host),
  'DCR client secrets stay inside the protected callback/refresh persistence path');   // `cur` = the single-flight refresh's freshest stored entry (was `t` before the per-connector refresh coalescing)
A.ok(/migrateConnectorCatalogKeyHeaders/.test(host) && /headers\[catalogEntry\.keyHeader\] = token;[\s\S]{0,80}token = ''/.test(host),
  'catalog-specific API key headers migrate and save without also sending a stale Bearer credential');
A.report('connector-reliability-wiring.test');
