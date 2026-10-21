import { broadcastProgress } from './state.js';

async function scrapeTracklist() {
  try {
    const grid = document.querySelector('[data-testid="playlist-tracklist"]');
    if (!grid) return { error: '트랙 목록을 찾지 못했습니다.' };
    let container = null;
    for (let el = grid.parentElement; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) {
        container = el;
        break;
      }
    }
    if (!container) return { error: '스크롤 영역을 찾지 못했습니다.' };

    const total = parseInt(grid.getAttribute('aria-rowcount'), 10) || 0;
    const targetKnown = total > 1;
    const collected = new Map();
    const harvest = () => {
      grid.querySelectorAll('[aria-rowindex]').forEach(row => {
        const idx = row.getAttribute('aria-rowindex');
        if (idx === '1') return;
        const text = row.innerText.trim();
        if (text) collected.set(idx, text);
      });
    };

    container.scrollTop = 0;
    await new Promise(r => setTimeout(r, 300));
    harvest();

    let stall = 0, lastSize = -1;
    const start = Date.now();
    const step  = Math.round(container.clientHeight * 0.7) || 600;
    while ((!targetKnown || collected.size < total - 1) && Date.now() - start < 120000) {
      container.scrollTop += step;
      await new Promise(r => setTimeout(r, 260));
      harvest();
      if (collected.size === lastSize) {
        stall++;
        if (stall > 30) break;
      } else {
        stall = 0;
      }
      lastSize = collected.size;
    }

    const songs = [...collected.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, raw]) => {
        const lines = raw.split('\n').filter(Boolean);
        const [title, artist] = lines.length >= 4 ? [lines[1], lines[2]] : [lines[0], lines[1]];
        return { title, artist };
      })
      .filter(s => s.title && s.artist);

    return { songs };
  } catch (e) {
    return { error: e.message };
  }
}

async function scrapeViaTab(playlistUrl) {
  // 백그라운드(비활성) 탭은 Chrome이 렌더링/타이머를 스로틀링해 가상 스크롤 목록이
  // 끝까지 로드되지 않으므로, 탭을 활성화 상태로 열어야 함
  const spotifyTabs = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
  let tabId, tempTabId = null, previousActiveTabId = null;

  if (spotifyTabs.length) {
    const tab = spotifyTabs[0];
    tabId = tab.id;
    if (!tab.active) {
      const [prev] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      previousActiveTabId = prev?.id ?? null;
    }
    if (!tab.url?.startsWith(playlistUrl)) {
      await chrome.tabs.update(tabId, { url: playlistUrl, active: true });
      await waitForTabComplete(tabId);
    } else if (!tab.active) {
      await chrome.tabs.update(tabId, { active: true });
    }
  } else {
    const [prev] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    previousActiveTabId = prev?.id ?? null;
    const tab = await chrome.tabs.create({ url: playlistUrl, active: true });
    tempTabId = tab.id;
    tabId     = tab.id;
    await waitForTabComplete(tabId);
  }

  await new Promise(r => setTimeout(r, 1500)); // 트랙리스트 렌더링 대기

  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: scrapeTracklist });
    if (result.error) throw new Error(result.error);
    return result.songs;
  } finally {
    if (tempTabId !== null) {
      chrome.tabs.remove(tempTabId).catch(() => {});
    } else if (previousActiveTabId !== null) {
      chrome.tabs.update(previousActiveTabId, { active: true }).catch(() => {});
    }
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Spotify 페이지 로딩 시간 초과'));
    }, 15000);
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

export async function fetchSpotifySongs(playlistUrl, shouldStop) {
  const playlistId = playlistUrl.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
  if (!playlistId) throw new Error('올바른 Spotify 플레이리스트 URL을 입력해주세요.');

  broadcastProgress({ log: 'ℹ Spotify 탭이 열리고 곡 목록을 모두 가져오기 위해 자동으로 스크롤됩니다. 잠시만 기다려주세요.', logType: 'info' });
  broadcastProgress({ step: 'Spotify 플레이리스트 로딩 중... (스크롤로 전체 곡 수집)' });
  const songs = await scrapeViaTab(`https://open.spotify.com/playlist/${playlistId}`);

  if (!songs.length) throw new Error('트랙 정보를 찾지 못했습니다. 플레이리스트가 공개 상태인지 확인하세요.');

  broadcastProgress({ log: `총 ${songs.length}곡 가져옴`, logType: 'info' });
  return songs;
}

// ── 여기부터 쓰기(Spotify에 생성/추가) ──────────────────────

function cleanYoutubeTitle(title) {
  return title
    .replace(/[\(\[][^)\]]*(official|m\/?v\b|mv\b|music\s*video|lyrics?|audio|visualizer|hd|4k|가사|뮤직비디오|공식)[^)\]]*[\)\]]/gi, '')
    .replace(/\b(official\s*(mv|video|audio|visualizer)|m\/v|music\s*video|lyrics?\s*video)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^\w가-힣ぁ-んァ-ヶ一-龯]/g, '');
}

export async function searchSpotifyTrack(token, title, channel) {
  const query = cleanYoutubeTitle(title) || title;
  const res = await fetch(`https://api.spotify.com/v1/search?type=track&limit=10&q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.error) throw new Error(`Spotify 검색 오류: ${data.error.message} (${data.error.status})`);

  const items = data.tracks?.items || [];
  if (!items.length) return null;

  const karaokeRe = /karaoke|노래방|instrumental|\binst\.?\b|mr\s*버전|off\s*vocal/i;
  const liveRe    = /\blive\b|라이브|concert|콘서트/i;
  const channelKey = normalize(channel);

  const score = (t, rank) => {
    const artistMatch = (t.artists || []).some(a => {
      const ak = normalize(a.name);
      return ak && (channelKey.includes(ak) || ak.includes(channelKey));
    });
    let s = Math.max(0, 20 - rank);
    if (artistMatch) s += 200;
    if (karaokeRe.test(t.name)) s -= 300;
    if (liveRe.test(t.name)) s -= 100;
    return s;
  };

  const best = items
    .map((t, i) => ({ t, s: score(t, i) }))
    .sort((a, b) => b.s - a.s)[0].t;

  return { uri: best.uri, name: best.name, artist: (best.artists || []).map(a => a.name).join(', ') };
}

export async function createSpotifyPlaylist(token, name) {
  const meRes = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${token}` } });
  const me = await meRes.json();
  if (!me.id) throw new Error(`Spotify 사용자 정보 조회 실패: ${JSON.stringify(me).slice(0, 200)}`);

  const res = await fetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, public: false }),
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Spotify 플레이리스트 생성 실패: ${JSON.stringify(data).slice(0, 200)}`);
  return data.id;
}

export function resolveSpotifyPlaylistId(url) {
  const m = url.match(/playlist\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('올바른 Spotify 플레이리스트 URL을 입력해주세요.');
  return m[1];
}

export async function addTrackToSpotifyPlaylist(token, playlistId, uri) {
  const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri] }),
  });
  const data = await res.json();
  if (!data.snapshot_id) throw new Error(`Spotify 추가 실패: ${JSON.stringify(data).slice(0, 200)}`);
}
