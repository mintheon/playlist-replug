import { broadcastProgress } from './state.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function fetchSpotifySongs(playlistUrl, shouldStop) {
  const playlistId = playlistUrl.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
  if (!playlistId) throw new Error('올바른 Spotify 플레이리스트 URL을 입력해주세요.');

  broadcastProgress({ step: 'Spotify 플레이리스트 로딩 중...' });
  const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Spotify 접근 오류 (HTTP ${res.status})`);
  const html = await res.text();

  const nextData = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!nextData) throw new Error('페이지 데이터를 찾지 못했습니다.');

  const trackList = JSON.parse(nextData).props?.pageProps?.state?.data?.entity?.trackList;
  if (!trackList?.length) throw new Error('트랙 정보를 찾지 못했습니다. 플레이리스트가 공개 상태인지 확인하세요.');

  const songs = trackList.map(t => ({ title: t.title, artist: t.subtitle }));
  broadcastProgress({ log: `총 ${songs.length}곡 가져옴`, logType: 'info' });
  return songs;
}
