// Share links: a project in the URL fragment (#p=<data>), which never reaches the server.
// <data> is 'z' + base64url(deflate-raw(JSON)) when CompressionStream is available, else
// 'u' + base64url(JSON). The run history is left out. No DOM: Node tests use this module too.
import * as Project from './project.js';

export const SHARE_PREFIX = '#p=';
export const LONG_LINK = 8000;

function toBase64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('the share link is damaged (unexpected characters)');
  const b = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  let s;
  try { s = atob(b); } catch { throw new Error('the share link is damaged (bad base64)'); }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// The largest project a share link may unpack to: a few KB of deflate can expand to gigabytes.
export const MAX_SHARE_BYTES = 8 * 1024 * 1024;

async function pipe(bytes, stream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      reader.cancel().catch(() => {});
      throw new RangeError(`the share link unpacks to more than ${limit / 1048576} MB`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// The data part of a share link for project p ({ compress: false } forces the plain form).
export async function encodeShare(p, { compress = typeof CompressionStream === 'function' } = {}) {
  const json = Project.save({ ...p, runs: [] }, { runs: false });
  const bytes = new TextEncoder().encode(JSON.stringify(JSON.parse(json)));
  if (compress) return 'z' + toBase64url(await pipe(bytes, new CompressionStream('deflate-raw')));
  return 'u' + toBase64url(bytes);
}

// The project of a share link's data part; throws with a readable message on a bad link.
export async function decodeShare(data) {
  const kind = data[0], body = data.slice(1);
  let bytes = fromBase64url(body);
  if (kind === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot read compressed share links');
    try { bytes = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_SHARE_BYTES); }
    catch (e) {
      if (e instanceof RangeError) throw new Error(e.message);
      throw new Error('the share link is damaged (cannot decompress)');
    }
  } else if (kind !== 'u') {
    throw new Error('the share link is damaged (unknown format)');
  }
  return Project.load(new TextDecoder().decode(bytes));
}

// The data part of a URL fragment ('#p=...'), or null.
export function shareData(hash) {
  return typeof hash === 'string' && hash.startsWith(SHARE_PREFIX) ? hash.slice(SHARE_PREFIX.length) : null;
}
