document.addEventListener('DOMContentLoaded', async () => {
  // ── DOM refs ──────────────────────────────────────────
  const startBtn      = document.getElementById('startBtn');
  const stopBtn       = document.getElementById('stopBtn');
  const progressEl    = document.getElementById('progress');
  const barFill       = document.getElementById('barFill');
  const barPct        = document.getElementById('barPct');
  const stepText      = document.getElementById('stepText');
  const logEl         = document.getElementById('log');
  const playlistLinkEl = document.getElementById('playlistLink');
  const platformSelect  = document.getElementById('platformSelect');
  const melonUrlInput   = document.getElementById('melonUrl');
  const playlistNameInput = document.getElementById('playlistName');
  const playlistUrlInput  = document.getElementById('playlistUrl');
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const newSection      = document.getElementById('newSection');
  const existingSection = document.getElementById('existingSection');
  const failOnlyCheck   = document.getElementById('failOnlyCheck');

  // ── UI 헬퍼 ───────────────────────────────────────────
  function setBar(val) {
    const pct = Math.round(val * 100);
    barFill.style.width = `${pct}%`;
    barPct.textContent  = `${pct}%`;
  }

  function setMode(mode) {
    newSection.style.display      = mode === 'new'      ? 'block' : 'none';
    existingSection.style.display = mode === 'existing' ? 'block' : 'none';
  }

  function setJobActive(active) {
    setInputsReadonly(active);
    startBtn.disabled        = active;
    stopBtn.style.display    = active ? 'block' : 'none';
  }

  function setInputsReadonly(readonly) {
    platformSelect.disabled     = readonly;
    melonUrlInput.readOnly      = readonly;
    playlistNameInput.readOnly  = readonly;
    playlistUrlInput.readOnly   = readonly;
    modeRadios.forEach(r => { r.disabled = readonly; });
  }

  function showPlaylistLink(playlistId) {
    if (!playlistId) return;
    playlistLinkEl.innerHTML = `<a href="https://www.youtube.com/playlist?list=${playlistId}" target="_blank">플레이리스트 열기</a>`;
    playlistLinkEl.style.display = 'block';
  }

  function appendLog(text, type = '') {
    const div = document.createElement('div');
    div.textContent = text;
    if (type) div.className = type;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function restoreLogs(logs) {
    if (!logs?.length) return;
    const frag = document.createDocumentFragment();
    logs.forEach(({ text, type }) => {
      const div = document.createElement('div');
      div.textContent = text;
      if (type) div.className = type;
      frag.appendChild(div);
    });
    logEl.appendChild(frag);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clearSourceInputs() {
    melonUrlInput.value     = '';
    playlistNameInput.value = '';
    playlistUrlInput.value  = '';
  }

  function handleJobDone(playlistId) {
    stepText.textContent = '완료!';
    showPlaylistLink(playlistId);
    setJobActive(false);
    clearSourceInputs();
    chrome.storage.local.remove('inputState');
  }

  function resetUI() {
    clearSourceInputs();
    modeRadios[0].checked = true;
    setMode('new');
    setJobActive(false);
    progressEl.style.display    = 'none';
    playlistLinkEl.style.display = 'none';
    logEl.innerHTML = '';
    logEl.classList.remove('fail-only');
    failOnlyCheck.checked = false;
    setBar(0);
    stepText.textContent = '';
    chrome.storage.local.remove('inputState');
  }

  failOnlyCheck.addEventListener('change', () => {
    logEl.classList.toggle('fail-only', failOnlyCheck.checked);
  });

  // ── 입력값 자동 저장 ──────────────────────────────────
  function saveInputs() {
    chrome.storage.local.set({
      inputState: {
        platform:     platformSelect.value,
        melonUrl:     melonUrlInput.value,
        playlistName: playlistNameInput.value,
        playlistUrl:  playlistUrlInput.value,
        mode: document.querySelector('input[name="mode"]:checked').value,
      },
    });
  }

  platformSelect.addEventListener('change', saveInputs);
  melonUrlInput.addEventListener('input', saveInputs);
  playlistNameInput.addEventListener('input', saveInputs);
  playlistUrlInput.addEventListener('input', saveInputs);
  modeRadios.forEach(r => r.addEventListener('change', () => { setMode(r.value); saveInputs(); }));

  // ── 이전 상태 복원 ────────────────────────────────────
  const { jobState, inputState } = await chrome.storage.local.get(['jobState', 'inputState']);

  if (inputState) {
    if (inputState.platform)     platformSelect.value    = inputState.platform;
    if (inputState.melonUrl)     melonUrlInput.value     = inputState.melonUrl;
    if (inputState.playlistName) playlistNameInput.value = inputState.playlistName;
    if (inputState.playlistUrl)  playlistUrlInput.value  = inputState.playlistUrl;
    if (inputState.mode)         setMode(inputState.mode);
    if (inputState.mode === 'existing') {
      document.querySelector('input[name="mode"][value="existing"]').checked = true;
    }
  }

  if (jobState) {
    progressEl.style.display = 'block';
    if (jobState.step) stepText.textContent = jobState.step;
    if (jobState.bar  !== undefined) setBar(jobState.bar);
    restoreLogs(jobState.logs);

    if (jobState.running) setJobActive(true);
    if (jobState.done)    handleJobDone(jobState.playlistId);
  }

  // ── 실시간 진행 수신 ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'PROGRESS') return;
    if (msg.step) stepText.textContent = msg.step;
    if (msg.bar  !== undefined) setBar(msg.bar);
    if (msg.log)  appendLog(msg.log, msg.logType || '');
    if (msg.error) {
      appendLog(`오류: ${msg.message}`, 'err');
      setJobActive(false);
    }
    if (msg.done) {
      handleJobDone(msg.playlistId);
    }
  });

  // ── 중지 버튼 ─────────────────────────────────────────
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_JOB' });
    resetUI();
  });

  // ── 시작 버튼 ─────────────────────────────────────────
  startBtn.addEventListener('click', async () => {
    const melonUrl    = melonUrlInput.value.trim();
    const mode        = document.querySelector('input[name="mode"]:checked').value;
    const playlistName = playlistNameInput.value.trim();
    const playlistUrl  = playlistUrlInput.value.trim();

    if (!melonUrl)                              { alert('멜론 URL을 입력해주세요.'); return; }
    if (mode === 'new'      && !playlistName)   { alert('플레이리스트 이름을 입력해주세요.'); return; }
    if (mode === 'existing' && !playlistUrl)    { alert('기존 플레이리스트 URL을 입력해주세요.'); return; }

    const tabs  = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    const tabId = tabs[0]?.id;
    if (!tabId) { alert('YouTube 탭을 열고 로그인 상태를 확인하세요.'); return; }

    await chrome.storage.local.set({ inputState: { platform: platformSelect.value, melonUrl, mode, playlistName, playlistUrl } });

    await chrome.storage.local.remove('jobState');
    setJobActive(true);
    progressEl.style.display    = 'block';
    playlistLinkEl.style.display = 'none';
    logEl.innerHTML     = '';
    stepText.textContent = '시작 중...';
    setBar(0);

    chrome.runtime.sendMessage(
      { type: 'START_JOB', payload: { melonUrl, mode, playlistName, playlistUrl, tabId } },
      (resp) => {
        if (resp?.error) {
          alert(resp.error);
          setJobActive(false);
        }
      }
    );
  });
});
