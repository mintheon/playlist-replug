import { broadcastProgress } from './state.js';

const PAGE_SIZE = 100;

async function fetchAllTracksViaTab(mylistId) {
  const vibeTabs = await chrome.tabs.query({ url: 'https://vibe.naver.com/*' });
  let tabId    = vibeTabs[0]?.id;
  let tempTabId = null;

  if (!tabId) {
    const tab = await chrome.tabs.create({ url: `https://vibe.naver.com/mylist/${mylistId}`, active: false });
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

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (mylistId, pageSize) => {
        // 스크립트 실행 결과 전달 시 async 함수 내 throw는 확장 쪽으로 전파되지 않으므로,
        // 에러를 { songs, error } 형태로 직접 반환한다.
        try {
          const songs = [];
          for (let start = 1; ; start += pageSize) {
            const url = `https://apis.naver.com/vibeWeb/musicapiweb/myMusic/myAlbum/${mylistId}/tracks?start=${start}&display=${pageSize}`;
            const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
            const bodyText = await res.text();

            if (!res.ok) {
              return { songs: [], error: `API 응답 오류 (status ${res.status}): ${bodyText.slice(0, 300)}` };
            }

            let json;
            try {
              json = JSON.parse(bodyText);
            } catch {
              return { songs: [], error: `JSON 파싱 실패: ${bodyText.slice(0, 300)}` };
            }

            const tracks = json?.response?.result?.tracks || [];
            if (!tracks.length) {
              if (start === 1) return { songs: [], error: `곡 목록이 비어있음 (응답: ${bodyText.slice(0, 500)})` };
              break;
            }

            songs.push(...tracks.map(t => ({
              title:  t.trackTitle,
              artist: (t.artists || []).map(a => a.artistName).join(', '),
            })));

            const total = json?.response?.result?.trackTotalCount ?? songs.length;
            if (songs.length >= total || tracks.length < pageSize) break;
          }
          return { songs, error: null };
        } catch (e) {
          return { songs: [], error: e.message };
        }
      },
      args: [mylistId, PAGE_SIZE],
    });
  } catch (e) {
    throw new Error(`Naver Vibe API 호출 실패: ${e.message}`);
  } finally {
    if (tempTabId !== null) chrome.tabs.remove(tempTabId).catch(() => {});
  }

  const frame = results?.[0];
  if (frame?.error) throw new Error(String(frame.error?.message || frame.error));

  const { songs, error } = frame?.result || { songs: [], error: '스크립트 실행 결과가 없습니다.' };
  if (error) throw new Error(error);
  return songs;
}

export async function fetchVibeSongs(inputUrl) {
  const idMatch = inputUrl.match(/mylist\/(\d+)/);
  if (!idMatch) throw new Error('mylist ID를 찾지 못했습니다.');

  const mylistId = idMatch[1];
  broadcastProgress({ step: 'Naver Vibe 플레이리스트 로딩 중...' });

  const songs = await fetchAllTracksViaTab(mylistId);
  if (!songs.length) throw new Error('곡 목록을 불러오지 못했습니다. Naver Vibe에 로그인되어 있는지 확인해주세요.');

  broadcastProgress({ log: `총 ${songs.length}곡 가져옴`, logType: 'info' });
  return songs;
}
