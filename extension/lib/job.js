import { broadcastProgress, flushState, initState } from './state.js';
import { fetchMelonSongs } from './melon.js';
import { ytExec } from './youtube.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

let _stopRequested = false;
let _isJobRunning  = false;

export const isJobRunning = () => _isJobRunning;

export function requestStop() {
  _stopRequested = true;
  _isJobRunning  = false;
}

export async function runJob({ melonUrl, mode, playlistName, playlistUrl, tabId }) {
  _stopRequested = false;
  _isJobRunning  = true;
  initState({ running: true, bar: 0, logs: [], melonUrl, mode, playlistName, playlistUrl });
  await flushState();

  const songs = await fetchMelonSongs(melonUrl, () => _stopRequested);
  broadcastProgress({ log: `Melon에서 ${songs.length}개 곡 가져옴`, logType: 'info' });

  const playlistId = await resolvePlaylist(tabId, mode, playlistName, playlistUrl);

  let added = 0, failed = 0;
  for (let i = 0; i < songs.length; i++) {
    if (_stopRequested) { broadcastProgress({ log: '중지됨.', logType: 'info' }); break; }

    const { title, artist } = songs[i];
    broadcastProgress({ step: `검색 + 추가 중... ${i + 1} / ${songs.length}`, bar: (i + 1) / songs.length });

    try {
      const corTitle = title.replace(/\s*[\(\[](feat|ft|featuring|with)[.\s][^\)\]]*/gi, '').trim();
      const video = await ytExec(tabId, ['search', { query: `${corTitle} ${artist.split(',')[0].trim()}`, title, artist }]);
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
  broadcastProgress({ log: '─────────────────────────────', logType: 'info' });
  broadcastProgress({ log: `★ 변환 완료 — ${added}개 추가, ${failed}개 실패`, logType: 'info' });
  await broadcastProgress({ done: true, running: false, added, failed, playlistId });
  // jobState는 유지 — 팝업 재오픈 시 로그 복원용. 다음 작업 시작 시 initState가 덮어씀
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
