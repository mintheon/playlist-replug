const CLIENT_ID  = '4fd64f51bf7c4052b94da62bf48a8fca';
const SCOPES     = 'playlist-modify-public playlist-modify-private';
const AUTH_URL    = 'https://accounts.spotify.com/authorize';
const TOKEN_URL   = 'https://accounts.spotify.com/api/token';

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFromVerifier(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

async function saveToken(tokenData, fallbackRefreshToken) {
  await chrome.storage.local.set({
    spotifyAuth: {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || fallbackRefreshToken,
      expires_at: Date.now() + tokenData.expires_in * 1000,
    },
  });
}

async function authorize() {
  const redirectUri = chrome.identity.getRedirectURL();
  const verifier  = randomToken();
  const challenge = await challengeFromVerifier(verifier);
  const state     = randomToken();

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);

  const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  const params = new URL(resultUrl).searchParams;
  if (params.get('state') !== state) throw new Error('Spotify 인증 상태값이 일치하지 않습니다.');

  const code = params.get('code');
  if (!code) throw new Error(`Spotify 로그인 실패: ${params.get('error') || '알 수 없는 오류'}`);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Spotify 토큰 발급 실패: ${JSON.stringify(data).slice(0, 200)}`);

  await saveToken(data);
  return data.access_token;
}

async function refreshToken(refresh_token) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: CLIENT_ID,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Spotify 토큰 갱신 실패: ${JSON.stringify(data).slice(0, 200)}`);

  await saveToken(data, refresh_token);
  return data.access_token;
}

export async function getAccessToken() {
  const { spotifyAuth } = await chrome.storage.local.get('spotifyAuth');

  if (spotifyAuth?.access_token && spotifyAuth.expires_at > Date.now() + 10000) {
    return spotifyAuth.access_token;
  }

  if (spotifyAuth?.refresh_token) {
    try {
      return await refreshToken(spotifyAuth.refresh_token);
    } catch {
      // 리프레시 실패 시 아래에서 재로그인 진행
    }
  }

  return authorize();
}
