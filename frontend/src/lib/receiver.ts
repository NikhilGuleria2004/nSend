import { connectSignaling, newPeerConnection } from './rtc';

type FileMeta = { name: string; size: number; type: string };

export function initReceiver() {
  const roomId = new URLSearchParams(location.search).get('id') ?? '';
  const statusEl = document.getElementById('status') as HTMLElement;
  const downloadsEl = document.getElementById('downloads') as HTMLElement;

  if (!roomId) {
    statusEl.textContent = 'No link id found. Ask the sender for a fresh link.';
    statusEl.className = 'text-sm text-red font-mono';
    return;
  }

  const ws = connectSignaling(roomId, 'receiver');
  const pc = newPeerConnection();

  let meta: FileMeta[] = [];
  let chunks: ArrayBuffer[] = [];

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({ type: 'signal', data: { candidate: e.candidate } }));
    }
  };

  pc.ondatachannel = (event) => {
    const channel = event.channel;
    channel.binaryType = 'arraybuffer';
    channel.onmessage = (msg) => {
      if (typeof msg.data === 'string') {
        const control = JSON.parse(msg.data);
        if (control.type === 'meta') {
          meta = control.files;
          statusEl.textContent = `Receiving ${meta.length} file(s)…`;
          statusEl.className = 'text-sm text-accent font-mono';
        } else if (control.type === 'file-start') {
          chunks = [];
        } else if (control.type === 'file-end') {
          const info = meta[control.index];
          const blob = new Blob(chunks, { type: info.type || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const li = document.createElement('li');
          li.className = 'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 border-2 border-border bg-surface hover:border-text transition-colors';
          const a = document.createElement('a');
          a.href = url;
          a.download = info.name;
          a.className = 'inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-accent hover:text-accent-hover transition-colors font-mono';
          a.innerHTML = `<span>[↓]</span><span class="truncate">${info.name}</span>`;
          const size = document.createElement('span');
          size.className = 'text-[10px] sm:text-xs text-text-dim font-mono sm:ml-auto';
          size.textContent = `${(info.size / 1024).toFixed(1)} KB`;
          li.appendChild(a);
          li.appendChild(size);
          downloadsEl.appendChild(li);
          chunks = [];
        } else if (control.type === 'done') {
          statusEl.textContent = 'All files received.';
          statusEl.className = 'text-sm text-accent font-mono';
        }
      } else {
        chunks.push(msg.data as ArrayBuffer);
      }
    };
  };

  ws.onmessage = async (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'signal') {
      const { sdp, candidate } = msg.data;
      if (sdp) {
        await pc.setRemoteDescription(sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'signal', data: { sdp: answer } }));
      }
      if (candidate) await pc.addIceCandidate(candidate);
    } else if (msg.type === 'peer-left') {
      statusEl.textContent = 'Sender disconnected.';
      statusEl.className = 'text-sm text-red font-mono';
    }
  };
}
