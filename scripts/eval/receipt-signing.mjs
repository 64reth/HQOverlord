import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    if (value[key] !== undefined) out[key] = ordered(value[key]);
    return out;
  }, {});
}

export function canonicalReceipt(receipt) {
  const unsigned = structuredClone(receipt);
  delete unsigned.signature;
  return Buffer.from(JSON.stringify(ordered(unsigned)), 'utf8');
}

function keyId(key) {
  const publicKey = key && key.type === 'public' ? key : createPublicKey(key);
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

export function generateReceiptKeyPair(privateFile, publicFile) {
  const pair = generateKeyPairSync('ed25519');
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  for (const file of [privateFile, publicFile]) mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(resolve(privateFile), privatePem, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(resolve(privateFile), 0o600); } catch (_) {}
  writeFileSync(resolve(publicFile), publicPem, 'utf8');
  return { privateFile: resolve(privateFile), publicFile: resolve(publicFile), keyId: keyId(pair.publicKey) };
}

export function signReceipt(receipt, privateFile) {
  const privateKey = createPrivateKey(readFileSync(resolve(privateFile), 'utf8'));
  const publicKey = createPublicKey(privateKey);
  const payload = canonicalReceipt(receipt);
  receipt.signature = {
    algorithm: 'Ed25519',
    keyId: keyId(publicKey),
    payloadSha256: createHash('sha256').update(payload).digest('hex'),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    value: sign(null, payload, privateKey).toString('base64')
  };
  return receipt;
}

export function verifyReceiptSignature(receipt) {
  const sig = receipt && receipt.signature;
  if (!sig || sig.algorithm !== 'Ed25519' || !sig.publicKey || !sig.value) return { ok: false, reason: 'missing Ed25519 signature' };
  try {
    const publicKey = createPublicKey(sig.publicKey);
    const payload = canonicalReceipt(receipt);
    const payloadSha256 = createHash('sha256').update(payload).digest('hex');
    if (payloadSha256 !== sig.payloadSha256) return { ok: false, reason: 'payload hash mismatch' };
    if (keyId(publicKey) !== sig.keyId) return { ok: false, reason: 'key id mismatch' };
    return verify(null, payload, publicKey, Buffer.from(sig.value, 'base64'))
      ? { ok: true, keyId: sig.keyId, payloadSha256 }
      : { ok: false, reason: 'signature verification failed' };
  } catch (error) { return { ok: false, reason: error.message || String(error) }; }
}
