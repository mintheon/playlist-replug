let _state = {};
let _persistTimer = null;

export function initState(initial) {
  _state = initial;
}

export function flushState() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  return chrome.storage.local.set({ jobState: _state });
}

function scheduleFlush() {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    chrome.storage.local.set({ jobState: _state });
  }, 2000);
}

export async function broadcastProgress(data) {
  if (data.log) _state.logs.push({ text: data.log, type: data.logType || '' });
  _state = { ..._state, ...data, logs: _state.logs, updatedAt: Date.now() };
  delete _state.log;
  delete _state.logType;

  chrome.runtime.sendMessage({ type: 'PROGRESS', ...data }).catch(() => {});

  if (data.done || data.error) {
    await flushState();
  } else {
    scheduleFlush();
  }

  if (data.done) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Playlist Replug',
      message: `변환 완료 — ${data.added}개 추가, ${data.failed}개 실패`,
    });
  }
}
