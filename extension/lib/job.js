import { broadcastProgress, flushState, initState } from './state.js';
import { fetchMelonSongs } from './melon.js';
import { fetchSpotifySongs } from './spotify.js';
import { ytExec } from './youtube.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

let _stopRequested = false;
let _isJobRunning  = false;

export const isJobRunning = () => _isJobRunning;

export function requestStop() {
  _stopRequested = true;
  _isJobRunning  = false;
}

export async function runJob({ platform, sourceUrl, spotifyTabId, mode, playlistName, playlistUrl, tabId }) {
  _stopRequested = false;
  _isJobRunning  = true;
  initState({ running: true, bar: 0, logs: [], platform, sourceUrl, mode, playlistName, playlistUrl });
  await flushState();

  const songs = platform === 'spotify'
    ? await fetchSpotifySongs(sourceUrl, spotifyTabId, () => _stopRequested)
    : await fetchMelonSongs(sourceUrl, () => _stopRequested);

  broadcastProgress({ log: `${songs.length}개 곡 가져옴`, logType: 'info' });

  const playlistId = await resolvePlaylist(tabId, mode, playlistName, playlistUrl);

  let added = 0, failed = 0;
  for (let i = 0; i < songs.length; i++) {
    if (_stopRequested) { broadcastProgress({ log: '중지됨.', logType: 'info' }); break; }

    const { title, artist } = songs[i];
    broadcastProgress({ step: `검색 + 추가 중... ${i + 1} / ${songs.length}`, bar: (i + 1) / songs.length });

    try {
      const video = await ytExec(tabId, ['search', { query: `${title} ${artist}` }]);
      if (!video) {
        broadcastProgress({ log: `✗ 검색 결과 없음: ${title} - ${artist}`, logType: 'err' });
        failed++;
        continue;
      }
      await ytExec(tabId, ['add', { plId: playlistId, vId: video.id }]);
      broadcastProgress({ log: `✓ [${video.tag}] ${title} - ${artist}`, logType: 'ok' });
      added++;
    } catch (e) {
      broadcastProgress({ log: `✗ ${title} - ${artist}: ${e.message}`, logType: 'err' });
      failed++;
    }

    await sleep(700);
  }

  _isJobRunning = false;
  await broadcastProgress({ done: true, running: false, added, failed, playlistId });
  await chrome.storage.local.remove(['jobState', 'inputState']);
}

async function resolvePlaylist(tabId, mode, playlistName, playlistUrl) {
  if (mode === 'existing') {
    const id = playlistUrl.match(/[?&]list=([^&]+)/)?.[1];
    if (!id) throw new Error('올바른 YouTube 플레이리스트 URL을 입력해주세요.');
    broadcastProgress({ log: `기존 플레이리스트 사용: ${id}`, logType: 'info' });
    return id;
  }
  broadcastProgress({ step: '플레이리스트 생성 중...' });
  const id = await ytExec(tabId, ['create', { name: playlistName }]);
  broadcastProgress({ log: `플레이리스트 생성됨: ${id}`, logType: 'info' });
  return id;
}
