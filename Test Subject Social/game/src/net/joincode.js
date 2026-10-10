/**
 * joincode.js — short codes for phone-to-phone online play.
 *
 * A join code packs the host's room code and the last two octets of its
 * LAN IPv4 address, e.g. "QAYC-7K2P". The joining device takes the first
 * two octets from its own address, which works because both devices must
 * be on the same Wi-Fi network (or the joiner is on the host's hotspot).
 *
 * The phone app's built-in server always listens on PHONE_PORT.
 */

export const PHONE_PORT = 8765;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I

/**
 * Internet codes (PeerJS Cloud): 6 symbols from the same unambiguous
 * alphabet, e.g. "K7QPXW". The public PeerJS id is derived from it.
 */
export function makeInternetCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** PeerJS id for an internet code (namespaced so it won't clash with other apps). */
export const internetPeerId = (code) => `test-subject-social-${code.toLowerCase()}`;

/** True if the typed text looks like an internet code (6 symbols, no dash). */
export function isInternetCode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length === 6 && [...clean].every((ch) => ALPHABET.includes(ch)) ? clean : null;
}

/** Build a join code from a room code and the host's IPv4 address. */
export function makeJoinCode(room, hostIp) {
  const parts = hostIp.split('.').map(Number);
  let v = (parts[2] << 8) | parts[3]; // 16 bits
  let tail = '';
  for (let i = 0; i < 4; i++) { tail = ALPHABET[v & 31] + tail; v >>= 5; }
  return `${room}-${tail}`;
}

/**
 * Parse a join code typed by the player.
 * @returns {{room: string, host: string} | null}
 */
export function parseJoinCode(code, ownIp) {
  const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 8 || !ownIp) return null;
  const room = clean.slice(0, 4), tail = clean.slice(4);
  let v = 0;
  for (const ch of tail) {
    const d = ALPHABET.indexOf(ch);
    if (d < 0) return null;
    v = (v << 5) | d;
  }
  if (v > 0xffff) return null;
  const own = ownIp.split('.');
  return { room, host: `${own[0]}.${own[1]}.${v >> 8}.${v & 255}` };
}
