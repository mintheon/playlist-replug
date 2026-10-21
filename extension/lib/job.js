import { broadcastProgress, flushState, initState } from './state.js';
import { fetchMelonSongs } from './melon.js';
import { fetchSpotifySongs, searchSpotifyTrack, createSpotifyPlaylist, resolveSpotifyPlaylistId, addTrackToSpotifyPlaylist } from './spotify.js';
import { fetchGenieSongs } from './genie.js';
import { fetchVibeSongs } from './vibe.js';
import { ytExec } from './youtube.js';
import { getAccessToken } from './spotify-auth.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

let _stopRequested = false;
let _isJobRunning  = false;

export const isJobRunning = () => _isJobRunning;

export function requestStop() {
  _stopRequested = true;
  _isJobRunning  = false;
}

export async function runJob({ direction = 'toYoutube', platform, sourceUrl, mode, playlistName, playlistUrl, tabId }) {
  _stopRequested = false;
  _isJobRunning  = true;
  initState({ running: true, bar: 0, logs: [], direction, platform, sourceUrl, mode, playlistName, playlistUrl });
  await flushState();

  try {
    if (direction === 'toSpotify') {
      await runToSpotify({ sourceUrl, mode, playlistName, playlistUrl, tabId });
    } else {
      await runToYoutube({ platform, sourceUrl, mode, playlistName, playlistUrl, tabId });
    }
  } catch (e) {
    _isJobRunning = false;
    throw e;
  }
}

async function runToYoutube({ platform, sourceUrl, mode, playlistName, playlistUrl, tabId }) {
  let songs;
  if (platform === 'genie') {
    songs = await fetchGenieSongs(sourceUrl);
    broadcastProgress({ log: `Genie에서 ${songs.length}개 곡 가져옴`, logType: 'info' });
  } else if (platform === 'vibe') {
    songs = await fetchVibeSongs(sourceUrl);
    broadcastProgress({ log: `Naver Vibe에서 ${songs.length}개 곡 가져옴`, logType: 'info' });
  } else if (platform === 'spotify') {
    songs = await fetchSpotifySongs(sourceUrl, () => _stopRequested);
    broadcastProgress({ log: `Spotify에서 ${songs.length}개 곡 가져옴`, logType: 'info' });
  } else {
    songs = await fetchMelonSongs(sourceUrl, () => _stopRequested);
    broadcastProgress({ log: `Melon에서 ${songs.length}개 곡 가져옴`, logType: 'info' });
  }

  const playlistId = await resolvePlaylist(tabId, mode, playlistName, playlistUrl);

  let added = 0, failed = 0;
  for (let i = 0; i < songs.length; i++) {
    if (_stopRequested) { broadcastProgress({ log: '중지됨.', logType: 'info' }); break; }

    const { title, artist } = songs[i];
    broadcastProgress({ step: `검색 + 추가 중... ${i + 1} / ${songs.length}`, bar: (i + 1) / songs.length });

    try {
      const corTitle = title.replace(/\s*[\(\[](feat|ft|featuring|with)[.\s][^\)\]]*/gi, '').trim();
      const video = await ytExec(tabId, ['search', { query: `${corTitle} ${artist.split(',')[0].trim()}`, title, artist }]);
      if (!video?.id) {
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

  await finishJob(added, failed, playlistId, 'toYoutube');
}

async function runToSpotify({ sourceUrl, mode, playlistName, playlistUrl, tabId }) {
  const ytPlaylistId = sourceUrl.match(/[?&]list=([^&]+)/)?.[1];
  if (!ytPlaylistId) throw new Error('올바른 YouTube 플레이리스트 URL을 입력해주세요.');

  broadcastProgress({ step: 'YouTube 플레이리스트 읽는 중...' });
  const videos = await ytExec(tabId, ['playlist', { playlistId: ytPlaylistId }]);
  if (!videos?.length) throw new Error('영상 목록을 가져오지 못했습니다.');
  broadcastProgress({ log: `YouTube에서 ${videos.length}개 영상 가져옴`, logType: 'info' });

  broadcastProgress({ step: 'Spotify 로그인 확인 중... (팝업이 뜨면 로그인해주세요)' });
  const token = await getAccessToken();

  const playlistId = mode === 'existing'
    ? resolveSpotifyPlaylistId(playlistUrl)
    : await (async () => {
        broadcastProgress({ step: 'Spotify 플레이리스트 생성 중...' });
        const id = await createSpotifyPlaylist(token, playlistName);
        broadcastProgress({ log: `Spotify 플레이리스트 생성됨: ${id}`, logType: 'info' });
        return id;
      })();

  let added = 0, failed = 0;
  for (let i = 0; i < videos.length; i++) {
    if (_stopRequested) { broadcastProgress({ log: '중지됨.', logType: 'info' }); break; }

    const { title, channel } = videos[i];
    broadcastProgress({ step: `검색 + 추가 중... ${i + 1} / ${videos.length}`, bar: (i + 1) / videos.length });

    try {
      const track = await searchSpotifyTrack(token, title, channel);
      if (!track) {
        broadcastProgress({ log: `✗ 검색 결과 없음: ${title}`, logType: 'err' });
        failed++;
        continue;
      }
      await addTrackToSpotifyPlaylist(token, playlistId, track.uri);
      broadcastProgress({ log: `✓ ${track.name} - ${track.artist}`, logType: 'ok' });
      added++;
    } catch (e) {
      broadcastProgress({ log: `✗ ${title}: ${e.message}`, logType: 'err' });
      failed++;
    }

    await sleep(300);
  }

  await finishJob(added, failed, playlistId, 'toSpotify');
}

async function finishJob(added, failed, playlistId, direction) {
  _isJobRunning = false;
  broadcastProgress({ log: '─────────────────────────────', logType: 'info' });
  broadcastProgress({ log: `★ 변환 완료 — ${added}개 추가, ${failed}개 실패`, logType: 'info' });
  await broadcastProgress({ done: true, running: false, added, failed, playlistId, direction });
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
