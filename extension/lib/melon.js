import { broadcastProgress } from './state.js';

const PAGE_SIZE = 50;
const sleep     = ms => new Promise(r => setTimeout(r, ms));

async function fetchAllPagesViaTab(plylstSeq) {
  // 서비스 워커 fetch는 Chrome HTTP 캐시 버그로 304 반환 → 탭 컨텍스트에서 실행
  const melonTabs = await chrome.tabs.query({ url: 'https://www.melon.com/*' });
  let tabId    = melonTabs[0]?.id;
  let tempTabId = null;

  if (!tabId) {
    const tab = await chrome.tabs.create({ url: 'https://www.melon.com/', active: false });
    tempTabId = tab.id;
    tabId     = tab.id;
    await new Promise(resolve => {
      const onUpdated = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (plylstSeq, pageSize) => {
        const titleRe  = /class="btn btn_icon_detail"[^>]*>\s*<span class="odd_span">([^<]+)<\/span>/g;
        const artistRe = /id="artistName"[^>]*>[\s\S]*?<a [^>]*>([^<]+)<\/a>/g;
        const referer  = `https://www.melon.com/mymusic/playlist/mymusicplaylistview_inform.htm?plylstSeq=${plylstSeq}`;
        const el       = document.createElement('textarea');
        const decode   = s => { el.innerHTML = s; return el.value; };
        const songs    = [];

        for (let page = 1; ; page++) {
          const url  = `https://www.melon.com/mymusic/playlist/mymusicplaylistview_listPagingSong.htm?plylstSeq=${plylstSeq}&startIndex=${(page - 1) * pageSize + 1}&pageSize=${pageSize}`;
          const text = await fetch(url, { headers: { Referer: referer } }).then(r => r.text());
          const titles  = [...text.matchAll(titleRe)].map(m => decode(m[1].trim()));
          const artists = [...text.matchAll(artistRe)].map(m => decode(m[1].trim()));
          const page_songs = titles.flatMap((title, i) => artists[i] ? [{ title, artist: artists[i] }] : []);

          if (!page_songs.length) break;
          songs.push(...page_songs);
          if (page_songs.length < pageSize) break;
        }
        return songs;
      },
      args: [plylstSeq, PAGE_SIZE],
    });
    return results[0]?.result || [];
  } finally {
    if (tempTabId !== null) chrome.tabs.remove(tempTabId).catch(() => {});
  }
}

export async function fetchMelonSongs(inputUrl, shouldStop) {
  let finalUrl = inputUrl;
  if (!inputUrl.includes('plylstSeq=')) {
    broadcastProgress({ step: '단축 URL 확인 중...' });
    const resp = await fetch(inputUrl, { redirect: 'follow' });
    finalUrl = resp.url;
  }

  const seqMatch = finalUrl.match(/plylstSeq=(\d+)/);
  if (!seqMatch) throw new Error(`plylstSeq를 찾지 못했습니다. 실제 URL: ${finalUrl}`);

  const plylstSeq = seqMatch[1];
  broadcastProgress({ step: 'Melon 플레이리스트 로딩 중...' });

  const songs = await fetchAllPagesViaTab(plylstSeq);

  broadcastProgress({ log: `총 ${songs.length}곡 가져옴`, logType: 'info' });
  return songs;
}
