# CiteReady — testing instructions

No login, no account, free to use. Desktop Chrome recommended.

## 1. Quick test (any browser, about 2 minutes)

1. Open **https://citeready.web.app**.
2. Click the sample **Public clinic page**, keep **Public page** selected, click **Check readiness**.
   - The **Where the AI ran** card lists each step with the requested mode (`PREFER_ON_DEVICE`) and the actual inference source. Without Gemini Nano it reads **Cloud · gemini-3.5-flash-lite**; with Nano ready it reads **On this device · Gemini Nano**.
   - Below: the readiness checklist with evidence, an answer-first summary, 5 likely questions with answers, the facts found (each verified against the text), missing items, vague claims, and FAQ JSON-LD.
3. Click the sample **Private launch draft** (it selects **Private draft**), click **Check readiness**.
   - Without Gemini Nano, CiteReady stops with **"Nothing has left this device"** and 0 characters sent. Click **Send a masked copy to the cloud** to continue; emails and phone numbers are masked before upload.
   - With Gemini Nano ready, both steps run **ONLY_ON_DEVICE** and the card shows **0 characters sent to the cloud**.
4. Click the sample **Long public page** (about 14,500 characters) and check it. It is over the on-device slice (12,000 characters, set in Remote Config), so fact extraction runs `ONLY_IN_CLOUD` and the short answer-kit step requests `PREFER_ON_DEVICE`.
5. Open **Routing options** to force **On-device only** or **Cloud only**. Forcing on-device without Nano shows "On-device model not ready" instead of silently using the cloud.

The pill in the top-right corner opens the on-device model panel: Chrome version, whether the Prompt API exists, Gemini Nano availability, the cloud fallback model and the active Remote Config policy.

## 2. Testing the on-device path (Gemini Nano)

Requires desktop Chrome 139 or newer on hardware that meets Chrome's built-in AI requirements, with enough free disk space for the model download.

1. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, set it to **Enabled**, and restart Chrome.
2. Open https://citeready.web.app and click the pill in the top-right corner. If it offers **Download Gemini Nano (one time)**, click it and wait for the progress bar. The first download can take several minutes.
3. When the pill reads **Gemini Nano ready on this device**, run the **Private launch draft** sample. Expected: "Ran entirely on this device", both steps `ONLY_ON_DEVICE` / **On this device · Gemini Nano**, 0 characters sent to the cloud.
4. Paste a longer private text (over 12,000 characters, for example the Long public page sample with **Private draft** selected). Expected: "Extract facts (part 1/2)", "(part 2/2)" and "Write answer kit", all on the device.

## 3. Chrome extension (optional)

1. Download or clone https://github.com/Canlah-AI/citeready.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose the `extension/` folder.
3. On any normal web page, click the CiteReady icon, optionally tick **This page is private**, click **Check this page**. CiteReady opens with the page text imported (passed in the URL fragment, which is never sent to a server).

## 4. Running from source

See the repository README ("Run it yourself"): Node 20+, your own Firebase project on the Spark plan with AI Logic (Gemini Developer API) and App Check (reCAPTCHA Enterprise), `cp .env.example .env.local`, `npm install`, `npm run dev`. Unit tests: `npm test`.

## Notes

- No production secrets, API keys or personal data are in the repository; the Firebase web config is read from `.env.local`, which is git-ignored.
- App Check (reCAPTCHA Enterprise) is enforced for Firebase AI Logic on the hosted app. If a cloud request is refused, reload the page.
- The cloud model runs on the free Gemini Developer API tier; under heavy use a request may hit a rate limit, in which case wait a minute and retry.
