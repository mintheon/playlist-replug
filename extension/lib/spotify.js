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
  const spotifyTabs = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
  let tabId     = spotifyTabs[0]?.id;
  let tempTabId = null;

  if (tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url?.startsWith(playlistUrl)) {
      await chrome.tabs.update(tabId, { url: playlistUrl });
      await waitForTabComplete(tabId);
    }
  } else {
    const tab = await chrome.tabs.create({ url: playlistUrl, active: false });
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
    if (tempTabId !== null) chrome.tabs.remove(tempTabId).catch(() => {});
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

  broadcastProgress({ step: 'Spotify 플레이리스트 로딩 중... (스크롤로 전체 곡 수집)' });
  const songs = await scrapeViaTab(`https://open.spotify.com/playlist/${playlistId}`);

  if (!songs.length) throw new Error('트랙 정보를 찾지 못했습니다. 플레이리스트가 공개 상태인지 확인하세요.');

  broadcastProgress({ log: `총 ${songs.length}곡 가져옴`, logType: 'info' });
  return songs;
}
