import { broadcastProgress } from './state.js';

const PAGE_SIZE = 100;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function loadEmbed(playlistId) {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Spotify 접근 오류 (HTTP ${res.status})`);
  const html = await res.text();

  const nextData = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!nextData) throw new Error('페이지 데이터를 찾지 못했습니다.');

  const parsed   = JSON.parse(nextData);
  const entity   = parsed.props?.pageProps?.state?.data?.entity;
  const token    = parsed.props?.pageProps?.state?.settings?.session?.accessToken;
  const total    = entity?.trackList?.length ?? 0;
  const snapshot = entity?.trackList?.map(t => ({ title: t.title, artist: t.subtitle })) ?? [];

  return { token, total, snapshot };
}

export async function fetchSpotifySongs(playlistUrl, shouldStop) {
  const playlistId = playlistUrl.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
  if (!playlistId) throw new Error('올바른 Spotify 플레이리스트 URL을 입력해주세요.');

  broadcastProgress({ step: 'Spotify 플레이리스트 로딩 중...' });
  const { token, snapshot } = await loadEmbed(playlistId);

  if (!snapshot.length) throw new Error('트랙 정보를 찾지 못했습니다. 플레이리스트가 공개 상태인지 확인하세요.');

  // 50곡 이하면 API 호출 없이 바로 반환
  if (snapshot.length < 50) {
    broadcastProgress({ log: `총 ${snapshot.length}곡 가져옴`, logType: 'info' });
    return snapshot;
  }

  // 50곡 이상이면 엠베드에서 추출한 토큰으로 REST API 페이지네이션
  if (!token) throw new Error('전체 곡 로딩에 필요한 토큰을 찾지 못했습니다.');

  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': UA };

  const infoRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=tracks.total`,
    { headers }
  );
  const info = await infoRes.json();
  if (info.error) throw new Error(`Spotify API: ${info.error.message} (${info.error.status})`);

  const totalCount = info.tracks.total;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  broadcastProgress({ log: `총 ${totalCount}곡 (${totalPages}페이지)`, logType: 'info' });

  const songs = [];
  for (let page = 0; page < totalPages; page++) {
    if (shouldStop()) break;
    broadcastProgress({ step: `${page + 1}/${totalPages}페이지 로딩 중...` });
    const res  = await fetch(
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
