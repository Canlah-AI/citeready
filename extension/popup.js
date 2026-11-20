// CiteReady extension: reads the visible text of the current tab and opens the
// CiteReady web app with it. All AI work (Firebase AI Logic hybrid inference,
// App Check) happens in the web app at https://citeready.web.app.
const APP_URL = 'https://citeready.web.app/';
const MAX_CHARS = 100000;

function extractPage() {
  const pick = document.querySelector('main, article, [role="main"]') || document.body;
  const text = (pick.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  return { t: document.title, u: location.href, x: text };
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

document.getElementById('go').addEventListener('click', async () => {
  const note = document.getElementById('note');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
    const data = { ...result, x: result.x.slice(0, MAX_CHARS), p: document.getElementById('private').checked ? 1 : 0 };
    await chrome.tabs.create({ url: `${APP_URL}#import=${toBase64Url(JSON.stringify(data))}` });
    window.close();
  } catch (e) {
    note.className = 'err';
    note.textContent = `Could not read this page (${e.message}). Browser pages like chrome:// cannot be read.`;
  }
});
