const LIVE_PROVIDER_KEYS = [
  'SKYNET_OPENROUTER_KEY',
  'STARNET_OPENROUTER_KEY',
  'OPENROUTER_API_KEY',
  'SKYNET_AUDIT_LIVE_PROVIDER'
];

export function providerKeyFromEnv(env = process.env) {
  return String(env.SKYNET_OPENROUTER_KEY || env.STARNET_OPENROUTER_KEY || env.OPENROUTER_API_KEY || '').trim();
}

export function hasLiveProviderKey(env = process.env) {
  return !!providerKeyFromEnv(env);
}

export function withoutLiveProviderEnv(extra = {}, base = process.env) {
  const env = Object.assign({}, base, extra);
  for (const key of LIVE_PROVIDER_KEYS) delete env[key];
  return env;
}

export function liveProviderEnv(extra = {}, base = process.env) {
  const key = providerKeyFromEnv(base);
  const env = Object.assign({}, base, extra);
  if (key) {
    env.SKYNET_OPENROUTER_KEY = key;
    env.STARNET_OPENROUTER_KEY = key;
  }
  env.SKYNET_AUDIT_LIVE_PROVIDER = '1';
  return env;
}
