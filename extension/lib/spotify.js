import { broadcastProgress } from './state.js';

const PAGE_SIZE = 100;

// Spotify 탭에 주입해서 액세스 토큰만 가져옴
async function spotifyTokenFn() {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
      { credentials: 'include', signal: controller.signal }
    );
    clearTimeout(tid);
    const data = await res.json();
    if (!data.accessToken || data.isAnonymous) return { ok: false, error: 'Spotify에 로그인되어 있는지 확인하세요.' };
    return { ok: true, data: data.accessToken };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '토큰 요청 시간 초과 — Spotify 탭을 확인하세요.' : e.message };
  }
}

async function getToken(spotifyTabId) {
  const res = await chrome.scripting.executeScript({
    target: { tabId: spotifyTabId }, world: 'MAIN', func: spotifyTokenFn, args: [],
  });
  const r = res[0]?.result;
  if (!r?.ok) throw new Error(r?.error || '토큰 획득 실패');
  return r.data;
}

export async function fetchSpotifySongs(playlistUrl, spotifyTabId, shouldStop) {
  const playlistId = playlistUrl.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
  if (!playlistId) throw new Error('올바른 Spotify 플레이리스트 URL을 입력해주세요.');

  broadcastProgress({ step: 'Spotify 토큰 가져오는 중...' });
  const token   = await getToken(spotifyTabId);
  const headers = { Authorization: `Bearer ${token}` };

  broadcastProgress({ step: '플레이리스트 정보 로딩 중...' });
  const infoRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.total`,
    { headers }
  );
  const info = await infoRes.json();
  if (!info.tracks?.total) throw new Error('플레이리스트를 가져올 수 없습니다. URL을 확인하세요.');

  const totalCount = info.tracks.total;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  broadcastProgress({ log: `총 ${totalCount}곡 (${totalPages}페이지)`, logType: 'info' });

  const songs = [];
  for (let page = 0; page < totalPages; page++) {
    if (shouldStop()) break;
    broadcastProgress({ step: `${page + 1}/${totalPages}페이지 로딩 중...` });
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&fields=items(track(name,artists(name)))`,
      { headers }
    );
    const data  = await res.json();
    const items = data.items
      ?.filter(item => item.track)
      .map(item => ({
        title:  item.track.name,
        artist: item.track.artists.map(a => a.name).join(', '),
      })) || [];
    songs.push(...items);
    broadcastProgress({ step: `${page + 1}/${totalPages}페이지: ${items.length}곡` });
  }

  return songs;
}
