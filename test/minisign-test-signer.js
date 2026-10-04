'use strict';
// Test-only minisign signer: generates an ed25519 keypair and produces signature
// documents in the exact format Tauri's signer (rsign2) emits, so tests can exercise
// scripts/minisign-verify.mjs and release-assemble-manifest.mjs with REAL crypto
// instead of placeholder strings. Mirrors the format notes in minisign-verify.mjs:
//   pubkey doc: untrusted comment line + base64("Ed" + keyId(8) + pub(32))
//   sig doc   : untrusted comment + base64(alg(2)+keyId(8)+sig(64))
//               + "trusted comment: ..." + base64(globalSig(64))
//   .sig file / manifest field = base64 of the WHOLE sig doc (Tauri convention).

const crypto = require('node:crypto');

function makeSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'); // 32 bytes
  const keyId = crypto.randomBytes(8);

  const pubkeyDoc = 'untrusted comment: minisign public key (test)\n' +
    Buffer.concat([Buffer.from('Ed'), keyId, rawPub]).toString('base64') + '\n';

  // opts: { alg: 'ED'|'Ed', corruptGlobal: bool, fileName: string }
  function sign(bytes, opts) {
    const o = opts || {};
    const alg = o.alg || 'ED';
    const message = alg === 'ED'
      ? crypto.createHash('blake2b512').update(bytes).digest()
      : Buffer.from(bytes);
    const sig = crypto.sign(null, message, privateKey);
    const trusted = 'timestamp:1700000000\tfile:' + (o.fileName || 'artifact');
    const globalSig = crypto.sign(null, Buffer.concat([sig, Buffer.from(trusted, 'utf8')]), privateKey);
    if (o.corruptGlobal) globalSig[0] ^= 0xff;
    const doc = 'untrusted comment: signature from test minisign key\n' +
      Buffer.concat([Buffer.from(alg), keyId, sig]).toString('base64') + '\n' +
      'trusted comment: ' + trusted + '\n' +
      globalSig.toString('base64') + '\n';
    return { doc, sigFileContent: Buffer.from(doc).toString('base64') };
  }

  return {
    pubkeyDoc,                                                    // pubkey file text
    pubkeyB64: Buffer.from(pubkeyDoc).toString('base64'),         // tauri.conf.json form
    keyIdHex: keyId.toString('hex'),
    sign,
  };
}

module.exports = { makeSigner };
