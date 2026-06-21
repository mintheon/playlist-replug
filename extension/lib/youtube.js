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

    if (action === 'search') return pickVideo(await post('search', { query: params.query }));

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
  function pickVideo(data) {
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

    const topic = items.find(isTopic);                       if (topic) return hit(topic, 'Music');
    const oacMv = items.find(v => isArtist(v) && hasMv(v)); if (oacMv) return hit(oacMv, '공식MV');
    const verMv = items.find(v => isVerif(v)  && hasMv(v)); if (verMv) return hit(verMv, '공식MV');
    const oac   = items.find(isArtist);                     if (oac)   return hit(oac,   '아티스트');
    const mv    = items.find(hasMv);                         if (mv)    return hit(mv,    'MV');
    return hit(items[0], '일반');
  }
}
