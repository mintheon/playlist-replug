import { broadcastProgress } from './state.js';

const UA        = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_SIZE = 50;
const sleep     = ms => new Promise(r => setTimeout(r, ms));

async function bgFetch(url, options = {}) {
  const resp = await fetch(url, options);
  return { ok: resp.ok, status: resp.status, url: resp.url, text: await resp.text() };
}

function parseMelonHtml(html) {
  const titleRe  = /class="btn btn_icon_detail"[^>]*>\s*<span class="odd_span">([^<]+)<\/span>/g;
  const artistRe = /id="artistName"[^>]*>[\s\S]*?<a [^>]*>([^<]+)<\/a>/g;
  const titles   = [...html.matchAll(titleRe)].map(m => m[1].trim());
  const artists  = [...html.matchAll(artistRe)].map(m => m[1].trim());
  return titles.flatMap((title, i) => artists[i] ? [{ title, artist: artists[i] }] : []);
}

export async function fetchMelonSongs(inputUrl, shouldStop) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };

  let finalUrl = inputUrl;
  if (!inputUrl.includes('plylstSeq=')) {
    broadcastProgress({ step: '단축 URL 확인 중...' });
    finalUrl = (await bgFetch(inputUrl, { redirect: 'follow', headers })).url;
  }

  const seqMatch = finalUrl.match(/plylstSeq=(\d+)/);
  if (!seqMatch) throw new Error(`plylstSeq를 찾지 못했습니다. 실제 URL: ${finalUrl}`);

  const plylstSeq = seqMatch[1];
  const referer   = `https://www.melon.com/mymusic/playlist/mymusicplaylistview_inform.htm?plylstSeq=${plylstSeq}`;
  const listUrl   = page => `https://www.melon.com/mymusic/playlist/mymusicplaylistview_listSong.htm?plylstSeq=${plylstSeq}&startIndex=${(page - 1) * PAGE_SIZE + 1}&pageSize=${PAGE_SIZE}`;

  broadcastProgress({ step: `플레이리스트 ID: ${plylstSeq} — 1페이지 로딩 중...` });
  const first      = await bgFetch(listUrl(1), { headers: { ...headers, Referer: referer } });
  const totalMatch = first.text.match(/수록곡\s*<span[^>]*>\((\d+)\)/);
  const totalCount = totalMatch ? parseInt(totalMatch[1], 10) : PAGE_SIZE;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  broadcastProgress({ log: `총 ${totalCount}곡 (${totalPages}페이지)`, logType: 'info' });

  const songs = parseMelonHtml(first.text);
  broadcastProgress({ step: `1/${totalPages}페이지: ${songs.length}곡` });

  for (let page = 2; page <= totalPages; page++) {
    if (shouldStop()) break;
    broadcastProgress({ step: `${page}/${totalPages}페이지 로딩 중...` });
    try {
      const resp      = await bgFetch(listUrl(page), { headers: { ...headers, Referer: referer } });
      const pageSongs = parseMelonHtml(resp.text);
      broadcastProgress({ step: `${page}/${totalPages}페이지: ${pageSongs.length}곡` });
      songs.push(...pageSongs);
    } catch (e) {
      broadcastProgress({ log: `${page}페이지 실패: ${e.message}`, logType: 'err' });
    }
    await sleep(300);
  }

  // Melon이 마지막 페이지에서 부족한 곡을 앞에서 채워 50개를 맞추므로 총 곡수로 잘라냄
  return songs.slice(0, totalCount);
}
