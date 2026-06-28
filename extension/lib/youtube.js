export async function ytExec(tabId, args) {
  const res = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: ytApiFn, args,
  });
  const r = res[0]?.result;
  if (!r)    throw new Error('executeScript 결과 없음');
  if (!r.ok) throw new Error(r.error || '알 수 없는 오류');
  return r.data;
}

// 페이지 컨텍스트에서 실행되는 함수 — 반드시 완전히 독립적이어야 함
async function ytApiFn(action, params) {
  try {
    const apiKey  = window.ytcfg?.data_?.INNERTUBE_API_KEY;
    const context = window.ytcfg?.data_?.INNERTUBE_CONTEXT;
    if (!apiKey || !context) return { ok: false, error: 'ytcfg 없음' };

    const sapisid = document.cookie.split(';').map(c => c.trim())
      .find(c => c.startsWith('__Secure-3PAPISID=') || c.startsWith('SAPISID='))
      ?.split('=').slice(1).join('=');

    const headers = { 'Content-Type': 'application/json', 'X-Goog-AuthUser': '0' };
    if (sapisid) {
      const ts   = Math.floor(Date.now() / 1000);
      const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} https://www.youtube.com`));
      const hex  = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
      headers['Authorization'] = `SAPISIDHASH ${ts}_${hex}`;
    }

    const post = (path, body) => fetch(`/youtubei/v1/${path}?key=${apiKey}&prettyPrint=false`, {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({ context, ...body }),
    }).then(r => r.json());

    if (action === 'search') return pickVideo(await post('search', { query: params.query }), params.title, params.artist);

    if (action === 'create') {
      const data = await post('playlist/create', { title: params.name, privacyStatus: 'PRIVATE' });
      return data.playlistId
        ? { ok: true, data: data.playlistId }
        : { ok: false, error: `API 응답: ${JSON.stringify(data).slice(0, 200)}` };
    }

    if (action === 'add') {
      const data = await post('browse/edit_playlist', {
        playlistId: params.plId,
        actions: [{ addedVideoId: params.vId, action: 'ACTION_ADD_VIDEO' }],
      });
      const ok = data.status === 'STATUS_SUCCEEDED' || !!data.playlistEditResults;
      return ok
        ? { ok: true, data: true }
        : { ok: false, error: `API 응답: ${JSON.stringify(data).slice(0, 200)}` };
    }
  } catch (e) { return { ok: false, error: e.message }; }

  // 검색 결과에서 우선순위에 따라 영상 선택
  function pickVideo(data, origTitle, origArtist) {
    const items = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents
      ?.flatMap(c => c.itemSectionRenderer?.contents || [])
      ?.filter(c => c.videoRenderer)?.map(c => c.videoRenderer) || [];
    if (!items.length) return { ok: true, data: null };

    const mvRe     = /official\s*(mv|m\/v|video|music\s*video)|[\[(](mv|m\/v)[)\]]|\bm\/v\b|\bmv\b|뮤직\s*비디오|뮤비/i;
    const liveRe   = /\blive\b|\bstage\b|콘서트|공연|음악방송|뮤직뱅크|인기가요|엠카운트다운|쇼챔피언|music.?core|inkigayo|m\.?countdown|show.?champion|showcase|컴백\s*무대|\[comeback/i;
    const badge    = v => v.ownerBadges?.[0]?.metadataBadgeRenderer?.style || '';
    const isTopic  = v => v.ownerText?.runs?.[0]?.text?.endsWith('- Topic');
    const isArtist = v => badge(v) === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST';
    const isVerif  = v => badge(v).includes('VERIFIED');
    const hasMv    = v => mvRe.test(v.title?.runs?.[0]?.text || '');

    const norm  = s => (s || '').toLowerCase().replace(/[^\w가-힣]/g, '');
    const featRe = /\s*[\(\[](feat|ft|featuring|with)[.\s][^\)\]]*/gi;
    const coreTitle   = (origTitle || '').replace(featRe, '').trim();
    const titleKey    = norm(coreTitle);
    const words       = coreTitle.toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{4,}/g) || [];
    const artistParts = (origArtist || '').toLowerCase()
      .split(/[,&/\s·-]+/).map(s => s.replace(/[^\w가-힣]/g, '')).filter(s => s.length >= 2);

    const score = v => {
      const vt = norm(v.title?.runs?.[0]?.text || '');
      const vc = norm(v.ownerText?.runs?.[0]?.text || '');
      const titleMatch  = titleKey && vt.includes(titleKey);
      const hintMatch   = words.some(w => vt.includes(w));
      const artistMatch = artistParts.some(a => vc.includes(a));

      if (!titleMatch && !hintMatch) return -Infinity; // 제목 무관 영상 제외

      return (isTopic(v)                                    ? 1000 : 0)
           + (isArtist(v)                                 ?  100 : 0)
           + (isVerif(v)                                  ?   50 : 0)
           + (hasMv(v)                                    ?  100 : 0)
           + (titleMatch                                  ?  200 : 0)
           + (hintMatch                                   ?   50 : 0)
           + (artistMatch && isVerif(v)                   ?  150 : 0)  // 미검증 팬채널 오탐 방지
           + (isArtist(v) && !artistMatch && !hasMv(v)    ? -200 : 0)  // MV는 신뢰, 커버 아티스트 비MV만 패널티
           + (liveRe.test(v.title?.runs?.[0]?.text || '') ? -150 : 0); // 라이브/방송 영상 감점
    };

    const scored = items.map(v => ({ v, s: score(v) })).filter(x => x.s > -Infinity).sort((a, b) => b.s - a.s);
    if (!scored.length) return { ok: true, data: null };

    const best = scored[0].v;
    const tag = isTopic(best) ? 'Music' : hasMv(best) ? '공식MV' : isArtist(best) ? '아티스트' : '일반';
    return { ok: true, data: { id: best.videoId, tag } };
  }
}
