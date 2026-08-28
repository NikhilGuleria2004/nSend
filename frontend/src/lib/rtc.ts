export type Role = 'sender' | 'receiver';

export function connectSignaling(room: string, role: Role): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return new WebSocket(`${proto}://${location.host}/ws?room=${room}&role=${role}`);
}

export function newPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
}
