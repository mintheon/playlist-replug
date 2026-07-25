import { runJob, requestStop, isJobRunning } from './lib/job.js';
import { broadcastProgress } from './lib/state.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_JOB') {
    if (isJobRunning()) {
      sendResponse({ error: '이미 진행 중인 작업이 있습니다.' });
      return true;
    }
    runJob(msg.payload).catch(e => {
      broadcastProgress({ error: true, message: e.message });
    });
    sendResponse({ started: true });
    return true;
  }

  if (msg.type === 'STOP_JOB') {
    requestStop();
    chrome.storage.local.remove('jobState');
    sendResponse({ ok: true });
  }
});
