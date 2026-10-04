#!/usr/bin/env node
/*
 * minisign-verify.mjs — cryptographically verify a Tauri updater signature against
 * the baked public key, in pure Node (no deps).
 *
 * WHY: the release pipeline used to check only that a .sig file exists, is non-empty,
 * and matches the manifest TEXT. It never proved the signature actually signs the
 * artifact bytes with OUR key. Tauri clients hard-reject a bad signature, so a
 * mismatched release (wrong key in CI, artifact swapped after signing, corrupted
 * upload) would pass every publish check and then fail the update for EVERY user.
 * This module closes that gap: verify(artifact, sig, pubkey) === the exact check the
 * installed app will run.
 *
 * FORMAT (minisign, as produced by Tauri's signer / rsign2):
 *   pubkey doc  : "untrusted comment: ..." \n base64(42B: "Ed" + keyId(8) + ed25519 pub(32))
 *                 tauri.conf.json plugins.updater.pubkey = base64 of that WHOLE doc.
 *   sig doc     : "untrusted comment: ..." \n base64(74B: alg(2) + keyId(8) + sig(64))
 *                 \n "trusted comment: ..." \n base64(globalSig(64))
 *                 A Tauri .sig file (and the manifest `signature` field) = base64 of
 *                 that WHOLE doc.
 *   alg "ED"    : signature is over blake2b512(artifact)   (prehashed — Tauri default)
 *   alg "Ed"    : signature is over the raw artifact bytes (legacy)
 *   global sig  : ed25519 over (sig(64) || trustedCommentText) — binds the timestamp/
 *                 filename comment to the signature.
 *
 * USAGE (CLI):
 *   node scripts/minisign-verify.mjs --artifact <file> [--sig <file.sig>]
 *       [--pubkey <base64-or-path>]        # default: src-tauri/tauri.conf.json pubkey
 *
 * Exit 0 = signature is valid for these exact bytes with this exact key.
 */

import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// RFC 8410 SPKI header for a raw 32-byte Ed25519 public key.
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function b64(s) {
  const buf = Buffer.from(String(s), 'base64');
  // Buffer.from silently tolerates garbage; round-trip length is the cheap sanity check.
  if (!buf.length) throw new Error('empty/invalid base64');
  return buf;
}

function keyFromRaw(raw) {
  const alg = raw.subarray(0, 2).toString('latin1');
  if (alg !== 'Ed') throw new Error('unsupported public key algorithm "' + alg + '" (want "Ed")');
  return { keyId: raw.subarray(2, 10), publicKey: raw.subarray(10, 42) };
}

// Accepts: the tauri.conf.json blob (base64 of the whole doc), the pubkey doc text,
// or a bare base64 key line. Returns { keyId(8), publicKey(32) }.
export function parsePublicKey(text) {
  let doc = String(text || '').trim();
  if (!doc) throw new Error('public key is empty');
  if (!/^untrusted comment:/i.test(doc)) {
    const decoded = b64(doc);
    if (decoded.length === 42) return keyFromRaw(decoded); // bare key line
    const asText = decoded.toString('utf8');
    if (!/^untrusted comment:/i.test(asText)) {
      throw new Error('public key is neither a minisign document, base64 of one, nor a bare key line');
    }
    doc = asText;
  }
  const keyLine = doc.split(/\r?\n/).map(l => l.trim())
    .find(l => l && !/^untrusted comment:/i.test(l));
  if (!keyLine) throw new Error('public key document has no key line');
  const raw = b64(keyLine);
  if (raw.length !== 42) throw new Error('public key line decodes to ' + raw.length + ' bytes (want 42)');
  return keyFromRaw(raw);
}

// Accepts a minisign signature doc, or base64 of one (= Tauri .sig content / manifest field).
export function parseSignature(text) {
  let doc = String(text || '').trim();
  if (!doc) throw new Error('signature is empty');
  if (!/^untrusted comment:/i.test(doc)) {
    const asText = b64(doc).toString('utf8');
    if (!/^untrusted comment:/i.test(asText)) {
      throw new Error('signature is neither a minisign document nor base64 of one');
    }
    doc = asText;
  }
  const lines = doc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 4) throw new Error('signature document has ' + lines.length + ' lines (want 4: comment, sig, trusted comment, global sig)');
  if (!/^untrusted comment:/i.test(lines[0])) throw new Error('signature document does not start with an untrusted comment');
  if (!/^trusted comment:/i.test(lines[2])) throw new Error('signature document line 3 is not a trusted comment');
  const sigRaw = b64(lines[1]);
  if (sigRaw.length !== 74) throw new Error('signature line decodes to ' + sigRaw.length + ' bytes (want 74)');
  const alg = sigRaw.subarray(0, 2).toString('latin1');
  if (alg !== 'ED' && alg !== 'Ed') throw new Error('unsupported signature algorithm "' + alg + '" (want "ED" or "Ed")');
  const globalSignature = b64(lines[3]);
  if (globalSignature.length !== 64) throw new Error('global signature decodes to ' + globalSignature.length + ' bytes (want 64)');
  return {
    alg,
    keyId: sigRaw.subarray(2, 10),
    signature: sigRaw.subarray(10, 74),
    trustedComment: lines[2].replace(/^trusted comment:\s*/i, ''),
    globalSignature,
  };
}

// The real check: does `sigText` sign `artifactBytes` with `pubkeyText`'s key?
// Returns { ok, reason, alg, trustedComment } — never throws on a BAD signature,
// only on malformed inputs the caller should treat as equally fatal.
export function verifySignature(artifactBytes, sigText, pubkeyText) {
  const pub = parsePublicKey(pubkeyText);
  const sig = parseSignature(sigText);
  const out = { ok: false, reason: '', alg: sig.alg, trustedComment: sig.trustedComment };

  if (!sig.keyId.equals(pub.keyId)) {
    out.reason = 'key id mismatch: signature is from key ' + sig.keyId.toString('hex') +
      ' but the public key is ' + pub.keyId.toString('hex') + ' — signed with a DIFFERENT key';
    return out;
  }

  const keyObject = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, pub.publicKey]),
    format: 'der',
    type: 'spki',
  });

  const message = sig.alg === 'ED'
    ? createHash('blake2b512').update(artifactBytes).digest() // prehashed (Tauri default)
    : Buffer.from(artifactBytes);

  if (!edVerify(null, message, keyObject, sig.signature)) {
    out.reason = 'ed25519 signature does not match the artifact bytes (artifact modified after signing, or wrong file)';
    return out;
  }

  const globalMsg = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, 'utf8')]);
  if (!edVerify(null, globalMsg, keyObject, sig.globalSignature)) {
    out.reason = 'trusted-comment (global) signature is invalid — signature document was tampered with';
    return out;
  }

  out.ok = true;
  return out;
}

// Resolve --pubkey: a path to a pubkey doc, an inline base64 blob, or (default) the
// key baked into src-tauri/tauri.conf.json — the one every installed app trusts.
export function resolvePubkeyText(arg, rootDir) {
  if (arg) {
    if (existsSync(arg)) return readFileSync(arg, 'utf8');
    return arg; // inline base64 / doc text
  }
  const confPath = join(rootDir, 'src-tauri', 'tauri.conf.json');
  const conf = JSON.parse(readFileSync(confPath, 'utf8').replace(/^﻿/, ''));
  const pubkey = conf.plugins && conf.plugins.updater && conf.plugins.updater.pubkey;
  if (!pubkey) throw new Error('no plugins.updater.pubkey in ' + confPath);
  return pubkey;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const val = (name) => {
    const eq = args.find(a => a.startsWith(name + '='));
    if (eq) return eq.slice(name.length + 1);
    const i = args.indexOf(name);
    return (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : undefined;
  };
  const artifact = val('--artifact');
  if (!artifact) { process.stderr.write('minisign-verify: --artifact <file> is required\n'); process.exit(2); }
  const sigFile = val('--sig') || artifact + '.sig';
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const pubkeyText = resolvePubkeyText(val('--pubkey'), ROOT);
    const res = verifySignature(readFileSync(artifact), readFileSync(sigFile, 'utf8'), pubkeyText);
    if (res.ok) {
      process.stdout.write('OK  ' + artifact + '\n    alg ' + res.alg + '  trusted comment: ' + res.trustedComment + '\n');
      process.exit(0);
    }
    process.stderr.write('FAIL ' + artifact + '\n    ' + res.reason + '\n');
    process.exit(1);
  } catch (e) {
    process.stderr.write('minisign-verify: ' + (e && e.message || e) + '\n');
    process.exit(1);
  }
}
