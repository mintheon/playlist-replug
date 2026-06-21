import { broadcastProgress } from './state.js';

const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

async function fetchPlaylistHtml(playlistId) {
  const res = await fetch(`https://open.spotify.com/playlist/${playlistId}`, {
    headers: { 'User-Agent': BOT_UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseJsonLd(html) {
  const songs = [];
  for (const [, content] of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(content);
      if (data['@type'] !== 'MusicPlaylist' || !data.track?.length) continue;
      for (const t of data.track) {
        const artist = Array.isArray(t.byArtist)
          ? t.byArtist.map(a => a.name).join(', ')
          : (t.byArtist?.name || '');
        if (t.name) songs.push({ title: t.name, artist });
      }
    } catch {}
  }
  return songs;
}

export async function fetchSpotifySongs(playlistUrl, shouldStop) {
  const playlistId = playlistUrl.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
  if (!playlistId) throw new Error('올바른 Spotify 플레이리스트 URL을 입력해주세요.');

  broadcastProgress({ step: 'Spotify 플레이리스트 로딩 중...' });
  const html  = await fetchPlaylistHtml(playlistId);
  const songs = parseJsonLd(html);

  if (!songs.length) throw new Error('트랙 정보를 찾지 못했습니다. 플레이리스트가 공개 상태인지 확인하세요.');

  broadcastProgress({ log: `총 ${songs.length}곡 가져옴`, logType: 'info' });
  return songs;
}
