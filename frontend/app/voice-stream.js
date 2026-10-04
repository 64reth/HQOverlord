/* Continuous local audio transport. Each PCM sample is uploaded once, in ordered small chunks. */
'use strict';
const VoiceStream = (() => {
  function mono16k(frames, rate) {
    const size = frames.reduce((n, f) => n + f.length, 0), input = new Float32Array(size);
    let at = 0; for (const frame of frames) { input.set(frame, at); at += frame.length; }
    if (rate === 16000) return input;
    const ratio = rate / 16000, output = new Float32Array(Math.floor(size / ratio));
    for (let i = 0; i < output.length; i++) {
      const start = Math.floor(i * ratio), end = Math.min(size, Math.floor((i + 1) * ratio));
      let sum = 0; for (let j = start; j < end; j++) sum += input[j];
      output[i] = sum / Math.max(1, end - start);
    }
    return output;
  }
  function open({ rate, onUpdate = () => {}, onError = () => {} }) {
    let id = '', frames = [], count = 0, closed = false, finishing = false, failed = false, pumping = null;
    let lastUpdate = '';
    function publish(update) {
      const key = JSON.stringify([update.stable, update.partial, update.text]);
      if (key === lastUpdate) return;
      lastUpdate = key; onUpdate(update);
    }
    const ac = new AbortController();
    async function request(action, body) {
      const requestAbort = new AbortController();
      const abort = () => requestAbort.abort();
      if (ac.signal.aborted) abort();
      ac.signal.addEventListener('abort', abort, {once:true});
      const timeout = setTimeout(abort, action === 'finish' ? 30000 : 15000);
      try {
        const res = await fetch('/api/local-voice/stream?action=' + action + (id ? '&id=' + encodeURIComponent(id) : ''), {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body, signal: requestAbort.signal
        });
        const result = await res.json();
        if (!res.ok || result.error) throw new Error(result.error || 'Continuous speech connection failed.');
        return result;
      } finally { clearTimeout(timeout); ac.signal.removeEventListener('abort', abort); }
    }
    const ready = request('open').then(result => {
      id = result.id;
      if (!id) throw new Error('Continuous speech is unavailable.');
      if (closed) fetch('/api/local-voice/stream?action=cancel&id=' + encodeURIComponent(id), {method:'POST'}).catch(() => {});
    });
    function report(error) {
      if (!closed && !failed) { failed = true; onError(error); }
    }
    ready.catch(report);
    async function flush() {
      await ready;
      while (frames.length && !closed) {
        const batch = []; let samples = 0;
        while (frames.length && samples + frames[0].length <= rate * .8) {
          const frame = frames.shift(); batch.push(frame); samples += frame.length;
        }
        if (!batch.length) throw new Error('Invalid audio frame size.');
        count -= samples;
        const pcm = mono16k(batch, rate);
        const update = await request('audio', pcm.buffer);
        if (!closed) publish(update);
      }
    }
    const timer = setInterval(() => {
      if (closed || finishing || failed || pumping || !frames.length) return;
      pumping = flush().catch(report).finally(() => { pumping = null; });
    }, 180);
    return {
      get failed() { return failed; },
      push(frame) {
        if (closed || finishing || failed) return;
        if (count + frame.length > rate * 8) { report(new Error('The speech connection is too slow.')); return; }
        frames.push(frame); count += frame.length;
      },
      async finish() {
        finishing = true; clearInterval(timer);
        if (pumping) await pumping;
        if (failed) throw new Error('Continuous speech failed.');
        await flush();
        const result = await request('finish');
        if (closed) throw new Error('Voice turn cancelled.');
        closed = true; publish(result); return result;
      },
      cancel() {
        closed = true; clearInterval(timer); frames = []; count = 0;
        // Let an in-flight open return its id so it can be released; all other pending requests abort.
        if (id) {
          ac.abort();
          fetch('/api/local-voice/stream?action=cancel&id=' + encodeURIComponent(id), {method:'POST'}).catch(() => {});
        }
      }
    };
  }
  return { open, mono16k };
})();
