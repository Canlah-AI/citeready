// Test double of Chrome's Prompt API (window.LanguageModel). NOT real inference.
//
// Use it to exercise CiteReady's on-device code paths in the real UI on a
// machine without Gemini Nano: inject it before the app loads (for example with
// Playwright's page.addInitScript or DevTools "Event Listener Breakpoints ->
// Script"), then run a private draft. The route card should show
// ONLY_ON_DEVICE steps and 0 characters sent to the cloud; long private drafts
// should show "Extract facts (part 1/N)" rows. window.__lm counts the calls.
//
// The real on-device path was verified separately on Chrome Canary 160 with
// Gemini Nano downloaded (see TESTING.md).
window.__lm = { calls: 0, chars: 0 };
window.LanguageModel = {
  availability: async () => 'available',
  create: async () => ({
    prompt: async (msgs, popts) => {
      window.__lm.calls++;
      window.__lm.chars += JSON.stringify(msgs).length;
      const s = popts && popts.responseConstraint;
      const isKit = s && s.properties && s.properties.summary;
      return JSON.stringify(
        isKit
          ? { summary: 'STUB summary from the Prompt API test double.', questions: [{ question: 'Stub question?', answer: '[add answer]', missing: true }] }
          : { name: 'Stub', category: 'stub', facts: [], vague: [] },
      );
    },
    promptStreaming: () => new ReadableStream({ start(c) { c.enqueue('{}'); c.close(); } }),
    destroy() {},
  }),
};
