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

    const mvRe     = /official\s*(mv|m\/v|video|music\s*video)|\(mv\)|\(m\/v\)|뮤직\s*비디오|뮤비/i;
    const badge    = v => v.ownerBadges?.[0]?.metadataBadgeRenderer?.style || '';
    const isTopic  = v => v.ownerText?.runs?.[0]?.text?.endsWith('- Topic');
    const isArtist = v => badge(v) === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST';
    const isVerif  = v => badge(v).includes('VERIFIED');
    const hasMv    = v => mvRe.test(v.title?.runs?.[0]?.text || '');
    const hit      = (v, tag) => ({ ok: true, data: { id: v.videoId, tag } });

    const norm      = s => (s || '').toLowerCase().replace(/[^\w가-힣]/g, '');
    const vTitle    = v => norm(v.title?.runs?.[0]?.text || '');
    const vChan     = v => norm(v.ownerText?.runs?.[0]?.text || '');
    // 피처링 정보 제거 후 핵심 제목만 사용
    const featRe    = /\s*[\(\[](feat|ft|featuring|with)[.\s][^\)\]]*/gi;
    const coreTitle = (origTitle || '').replace(featRe, '').trim();
    const titleKey  = norm(coreTitle);
    // 제목 완전 포함 (정규화 후)
    const titleFit  = v => titleKey && vTitle(v).includes(titleKey);
    // 키워드 힌트: 핵심 제목에서 단어 경계 기준 추출
    const words     = coreTitle.toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{4,}/g) || [];
    const titleHint = v => words.some(w => vTitle(v).includes(w));
    // 아티스트 채널명 검증: 구분자로 나눈 파트 중 하나라도 채널명에 포함
    const artistParts = (origArtist || '').toLowerCase()
      .split(/[,&\/\s·\-]+/).map(s => s.replace(/[^\w가-힣]/g, '')).filter(s => s.length >= 2);
    const artistFit = v => !artistParts.length || artistParts.some(a => vChan(v).includes(a));

    // 1차: 제목 정확 일치
    const topic   = items.find(v => isTopic(v)  && titleFit(v));                         if (topic)    return hit(topic,   'Music');
    const oacMv   = items.find(v => isArtist(v) && hasMv(v) && titleFit(v));             if (oacMv)    return hit(oacMv,   '공식MV');
    const verMv   = items.find(v => isVerif(v)  && hasMv(v) && titleFit(v));             if (verMv)    return hit(verMv,   '공식MV');
    const oac     = items.find(v => isArtist(v) && titleFit(v));                          if (oac)      return hit(oac,     '아티스트');
    const any     = items.find(v => titleFit(v) && artistFit(v));                         if (any)      return hit(any,     '일반');
    // 2차: Topic 채널 신뢰 (영문 제목 대응 — YouTube 검색이 이미 제목+아티스트로 필터링)
    const topicH  = items.find(v => isTopic(v)  && titleHint(v));                        if (topicH)   return hit(topicH,  'Music');
    const topicAny = items.find(v => isTopic(v));                                         if (topicAny) return hit(topicAny,'Music');
    // 3차: 키워드 힌트 + 아티스트 검증
    const oacMvH  = items.find(v => isArtist(v) && hasMv(v) && titleHint(v));            if (oacMvH)   return hit(oacMvH,  '공식MV');
    const verMvH  = items.find(v => isVerif(v)  && hasMv(v) && titleHint(v));            if (verMvH)   return hit(verMvH,  '공식MV');
    const oacH    = items.find(v => isArtist(v) && titleHint(v));                         if (oacH)     return hit(oacH,    '아티스트');
    const anyH    = items.find(v => titleHint(v) && artistFit(v));                        if (anyH)     return hit(anyH,    '일반');

    return { ok: true, data: null };
  }
}
