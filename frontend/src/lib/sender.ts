import { connectSignaling, newPeerConnection } from './rtc';

const CHUNK_SIZE = 16 * 1024;

export function initSender() {
  const filesInput = document.getElementById('files') as HTMLInputElement;
  const sendBtn = document.getElementById('send') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLElement;
  const linkEl = document.getElementById('link') as HTMLElement;

  sendBtn.addEventListener('click', async () => {
    const files = filesInput.files;
    if (!files || files.length === 0) {
      statusEl.textContent = 'Choose at least one file.';
      statusEl.className = 'text-sm text-red h-5 font-mono';
      return;
    }
    sendBtn.disabled = true;

    const room = crypto.randomUUID();
    const link = `${location.origin}/r?id=${room}`;
    linkEl.innerHTML = `Share this link with the receiver: <a href="${link}" class="text-accent underline hover:text-accent-hover transition-colors break-all font-mono">${link}</a><button id="copyBtn" class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-mono text-text-muted bg-surface border-2 border-border hover:border-text hover:text-text transition-colors whitespace-nowrap flex-shrink-0">[COPY]</button>`;
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(link);
          copyBtn.textContent = '[COPIED]';
          copyBtn.classList.add('bg-text', 'text-bg');
          setTimeout(() => {
            copyBtn.textContent = '[COPY]';
            copyBtn.classList.remove('bg-text', 'text-bg');
          }, 2000);
        } catch {
          copyBtn.textContent = '[FAIL]';
        }
      });
    }
    statusEl.textContent = 'Waiting for the receiver to open the link…';
    statusEl.className = 'text-sm text-amber h-5 font-mono';

    const ws = connectSignaling(room, 'sender');
    const pc = newPeerConnection();
    const channel = pc.createDataChannel('files');
    channel.binaryType = 'arraybuffer';

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ws.send(JSON.stringify({ type: 'signal', data: { candidate: e.candidate } }));
      }
    };

    ws.onmessage = async (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'peer-joined') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'signal', data: { sdp: offer } }));
      } else if (msg.type === 'signal') {
        const { sdp, candidate } = msg.data;
        if (sdp) await pc.setRemoteDescription(sdp);
        if (candidate) await pc.addIceCandidate(candidate);
      } else if (msg.type === 'peer-left') {
        statusEl.textContent = 'Receiver disconnected.';
        statusEl.className = 'text-sm text-red h-5 font-mono';
      }
    };

    channel.onopen = async () => {
      statusEl.textContent = 'Connected. Sending…';
      statusEl.className = 'text-sm text-amber h-5 font-mono';
      const fileList = Array.from(files);
      channel.send(JSON.stringify({
        type: 'meta',
        files: fileList.map((f) => ({ name: f.name, size: f.size, type: f.type }))
      }));
      for (let i = 0; i < fileList.length; i++) {
        await sendFile(channel, fileList[i], i);
      }
      channel.send(JSON.stringify({ type: 'done' }));
      statusEl.textContent = 'All files sent.';
      statusEl.className = 'text-sm text-accent h-5 font-mono';
    };
  });

  async function sendFile(channel: RTCDataChannel, file: File, index: number) {
    channel.send(JSON.stringify({ type: 'file-start', index }));
    const buf = await file.arrayBuffer();
    let offset = 0;
    while (offset < buf.byteLength) {
      if (channel.bufferedAmount > 8 * CHUNK_SIZE) {
        await new Promise((r) => setTimeout(r, 10));
        continue;
      }
      channel.send(buf.slice(offset, offset + CHUNK_SIZE));
      offset += CHUNK_SIZE;
    }
    channel.send(JSON.stringify({ type: 'file-end', index }));
  }
}
