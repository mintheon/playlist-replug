import { broadcastProgress } from './state.js';

async function fetchSongsViaTab(mxnm) {
  const genieUrl = `https://www.genie.co.kr/myMusic/myfolder?mxnm=${mxnm}`;
  const genieTabs = await chrome.tabs.query({ url: 'https://www.genie.co.kr/*' });
  let tabId    = genieTabs[0]?.id;
  let tempTabId = null;

  if (!tabId) {
    const tab = await chrome.tabs.create({ url: genieUrl, active: false });
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
  } else {
    await chrome.tabs.update(tabId, { url: genieUrl });
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
      func: () => {
        const rows = document.querySelectorAll('tr.list');
        return Array.from(rows).flatMap(row => {
          const title  = row.querySelector('.title.ellipsis')?.textContent?.trim();
          const artist = row.querySelector('.artist.ellipsis')?.textContent?.trim();
          return title && artist ? [{ title, artist }] : [];
        });
      },
    });
    return results[0]?.result || [];
  } finally {
    if (tempTabId !== null) chrome.tabs.remove(tempTabId).catch(() => {});
  }
}

export async function fetchGenieSongs(inputUrl) {
  const mxnmMatch = inputUrl.match(/mxnm=(\d+)/);
  if (!mxnmMatch) throw new Error('mxnm 파라미터를 찾지 못했습니다.');

  const mxnm = mxnmMatch[1];
  broadcastProgress({ step: 'Genie 플레이리스트 로딩 중...' });

  const songs = await fetchSongsViaTab(mxnm);
  if (!songs.length) throw new Error('곡 목록을 불러오지 못했습니다. Genie에 로그인되어 있는지 확인해주세요.');

  broadcastProgress({ log: `총 ${songs.length}곡 가져옴`, logType: 'info' });
  return songs;
}
