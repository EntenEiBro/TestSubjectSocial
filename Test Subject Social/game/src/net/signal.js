/**
 * signal.js — WebSocket connection to the LAN signaling relay in serve.py,
 * plus the WebRTC configurations for LAN and internet play.
 *
 * Online play works like "remote play": the HOST runs the whole game and
 * streams it; CLIENTS only watch and send controller input. The relay is
 * used just to exchange WebRTC offers/answers/ICE candidates — after that
 * video, UI and input flow peer-to-peer over an RTCPeerConnection.
 */

/**
 * WebRTC configuration. LAN play needs no ICE servers. For play over the
 * internet a STUN server is required; add one here (for example
 * `{ urls: 'stun:stun.l.google.com:19302' }`) or pass `?stun=<url>`.
 */
export function rtcConfig() {
  const stun = new URLSearchParams(location.search).get('stun');
  return { iceServers: stun ? [{ urls: stun.startsWith('stun:') ? stun : `stun:${stun}` }] : [] };
}

/**
 * WebRTC configuration for internet play: Google's public STUN server plus
 * the free TURN relays that come with PeerJS Cloud (used only when the two
 * devices cannot reach each other directly).
 */
export const INTERNET_RTC = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ],
  sdpSemantics: 'unified-plan',
};

/** Build the relay URL for a room on the current origin. */
export function relayUrl(room, role) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws?${new URLSearchParams({ room, role })}`;
}

/** Thin promise-friendly wrapper around the relay WebSocket. */
export class Signal {
  /**
   * @param {string} room  room code
   * @param {'host'|'client'} role
   */
  constructor(room, role) {
    this.ws = new WebSocket(relayUrl(room, role));
    this.onMessage = null; // (msg) => void
    this.onClose = null;   // (reason) => void
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('Could not reach the relay (is serve.py running?)'));
    });
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (this.onMessage) this.onMessage(msg);
    };
    this.ws.onclose = () => { if (this.onClose) this.onClose('connection closed'); };
  }

  send(obj) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }
  close() { this.ws.close(); }
}

/** Random, unambiguous 4-letter room code. */
export function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}
