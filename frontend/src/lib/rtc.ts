export type Role = 'sender' | 'receiver';

// Falls back to the page's own origin so nothing breaks for single-host
// setups (e.g. `npm start`, where Hono serves both the site and /ws).
// Set PUBLIC_BACKEND_URL at build time when the backend lives elsewhere.
const BACKEND_URL = import.meta.env.PUBLIC_BACKEND_URL || location.origin;

export function connectSignaling(room: string, role: Role): WebSocket {
  const url = new URL('/ws', BACKEND_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('room', room);
  url.searchParams.set('role', role);
  return new WebSocket(url);
}

export function newPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
}