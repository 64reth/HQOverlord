/* sidecar/file-response.js — shared file/download response policy. */
'use strict';

const path = require('node:path');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.opus': 'audio/ogg; codecs=opus'
});

const CHANNEL_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const ACTIVE_DELIVERABLE_EXTS = new Set(['.html', '.htm', '.xhtml', '.js', '.mjs', '.cjs', '.svg', '.xml', '.xsl', '.xslt', '.wasm']);

function mimeForPath(file) {
  const mime = MIME[path.extname(String(file || '')).toLowerCase()];
  return mime ? String(mime).split(';')[0].trim() : 'application/octet-stream';
}

function safeDownloadName(file) {
  return path.basename(file).replace(/[^A-Za-z0-9_.-]/g, '_') || 'download';
}

function isActiveDeliverable(file) {
  return ACTIVE_DELIVERABLE_EXTS.has(path.extname(file).toLowerCase());
}

// Parse one RFC 7233 byte range. Multi-range requests are deliberately unsupported because the media/file
// callers only need seeking and resumable single ranges.
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '')) return { unsatisfiable: true };
  let start;
  let end;
  if (match[1] === '') {
    const count = parseInt(match[2], 10);
    if (!count) return { unsatisfiable: true };
    start = Math.max(0, size - count);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : Math.min(parseInt(match[2], 10), size - 1);
  }
  if (!(start >= 0) || start > end || start >= size) return { unsatisfiable: true };
  return { start, end };
}

module.exports = { MIME, CHANNEL_UPLOAD_MAX_BYTES, mimeForPath, safeDownloadName, isActiveDeliverable, parseRange };
