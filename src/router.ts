// CiteReady's routing policy, layered on top of Firebase AI Logic's inference
// modes. Pure functions only, so the whole policy is unit-tested.
//
// The SDK already knows how to "prefer on-device, else cloud". What it cannot
// know is whether the text is allowed to leave the device. CiteReady adds that:
//   - private drafts run ONLY_ON_DEVICE, are chunked when long, and never fall
//     back to the cloud silently; the user must consent, and contacts are masked;
//   - public pages run PREFER_ON_DEVICE, and go ONLY_IN_CLOUD when they are too
//     long for the on-device context window.

export type Sensitivity = 'private' | 'public';

/** Result of LanguageModel.availability(), plus 'no-api' when the Prompt API is missing. */
export type NanoState = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

export type Override = 'auto' | 'device' | 'cloud';

/** Mirrors firebase/ai InferenceMode values. */
export type Mode = 'prefer_on_device' | 'only_on_device' | 'only_in_cloud' | 'prefer_in_cloud';

export type Plan =
  | 'on-device'
  | 'on-device-chunked'
  | 'prefer-on-device'
  | 'cloud'
  | 'needs-consent'
  | 'needs-device';

export interface RouteInput {
  sensitivity: Sensitivity;
  chars: number;
  nano: NanoState;
  maxDeviceChars: number;
  maxPrivateChunks: number;
  override: Override;
  /** User clicked "send to cloud" for a private draft. */
  cloudConsent: boolean;
  maskContactsForCloud: boolean;
}

export interface Route {
  plan: Plan;
  /** Mode for the fact-extraction step (reads the full text). */
  factsMode: Mode;
  /** Mode for the answer-kit step (reads only the extracted facts, which are short). */
  kitMode: Mode;
  chunks: number;
  maskForCloud: boolean;
  /** One plain sentence shown in the UI. */
  reason: string;
}

export function chunksNeeded(chars: number, maxDeviceChars: number): number {
  return Math.max(1, Math.ceil(chars / Math.max(1, maxDeviceChars)));
}

const nanoWhy: Record<NanoState, string> = {
  available: 'Gemini Nano is ready in this browser',
  downloadable: 'Gemini Nano is supported here but not downloaded yet',
  downloading: 'Gemini Nano is still downloading',
  unavailable: 'this device cannot run Gemini Nano right now',
  'no-api': 'this browser has no built-in Prompt API (Chrome desktop 139+ is needed)',
};

export function nanoReason(n: NanoState): string {
  return nanoWhy[n];
}

export function decideRoute(i: RouteInput): Route {
  const deviceReady = i.nano === 'available';
  const n = chunksNeeded(i.chars, i.maxDeviceChars);
  const fits = n === 1;
  const len = i.chars.toLocaleString('en-US');
  const slice = i.maxDeviceChars.toLocaleString('en-US');

  // Manual overrides, used for testing and the demo.
  if (i.override === 'cloud') {
    if (i.sensitivity === 'private' && !i.cloudConsent) {
      return {
        plan: 'needs-consent',
        factsMode: 'only_in_cloud',
        kitMode: 'only_in_cloud',
        chunks: 1,
        maskForCloud: i.maskContactsForCloud,
        reason: 'You chose cloud, but this is marked as a private draft. Nothing has been sent; confirm first.',
      };
    }
    return {
      plan: 'cloud',
      factsMode: 'only_in_cloud',
      kitMode: 'only_in_cloud',
      chunks: 1,
      maskForCloud: i.sensitivity === 'private' && i.maskContactsForCloud,
      reason: 'Cloud forced by the routing override.',
    };
  }
  if (i.override === 'device') {
    if (!deviceReady) {
      return {
        plan: 'needs-device',
        factsMode: 'only_on_device',
        kitMode: 'only_on_device',
        chunks: n,
        maskForCloud: false,
        reason: `On-device forced, but ${nanoReason(i.nano)}.`,
      };
    }
    return {
      plan: fits ? 'on-device' : 'on-device-chunked',
      factsMode: 'only_on_device',
      kitMode: 'only_on_device',
      chunks: n,
      maskForCloud: false,
      reason: fits
        ? 'On-device forced by the routing override.'
        : `On-device forced; the text is split into ${n} parts of up to ${slice} characters each.`,
    };
  }

  if (i.sensitivity === 'private') {
    if (deviceReady && n <= i.maxPrivateChunks) {
      return {
        plan: fits ? 'on-device' : 'on-device-chunked',
        factsMode: 'only_on_device',
        kitMode: 'only_on_device',
        chunks: n,
        maskForCloud: false,
        reason: fits
          ? 'Private draft and Gemini Nano is ready, so everything runs on this device. Nothing is uploaded.'
          : `Private draft (${len} characters) is over the on-device slice of ${slice} characters, so it is split into ${n} parts. All of them run on this device.`,
      };
    }
    if (i.cloudConsent) {
      return {
        plan: 'cloud',
        factsMode: 'only_in_cloud',
        kitMode: deviceReady ? 'only_on_device' : 'only_in_cloud',
        chunks: 1,
        maskForCloud: i.maskContactsForCloud,
        reason: deviceReady
          ? `You allowed the cloud for this long private draft (${n} parts is over the on-device limit of ${i.maxPrivateChunks}). The answer kit is still written on this device.`
          : `You allowed the cloud because ${nanoReason(i.nano)}.${i.maskContactsForCloud ? ' Emails and phone numbers are masked before upload.' : ''}`,
      };
    }
    return {
      plan: 'needs-consent',
      factsMode: 'only_in_cloud',
      kitMode: 'only_in_cloud',
      chunks: n,
      maskForCloud: i.maskContactsForCloud,
      reason: deviceReady
        ? `This private draft would need ${n} on-device parts (limit ${i.maxPrivateChunks}). Nothing has been sent. Shorten it, or allow the cloud.`
        : `Private draft, and ${nanoReason(i.nano)}. Nothing has been sent. Allow the cloud, or prepare Gemini Nano first.`,
    };
  }

  // Public page.
  if (!fits) {
    return {
      plan: 'cloud',
      factsMode: 'only_in_cloud',
      kitMode: 'prefer_on_device',
      chunks: 1,
      maskForCloud: false,
      reason: `Public page (${len} characters) is over the on-device slice of ${slice} characters, so the cloud model reads it in one pass. The short answer kit is written on-device when Nano is ready.`,
    };
  }
  return {
    plan: deviceReady ? 'on-device' : 'prefer-on-device',
    factsMode: 'prefer_on_device',
    kitMode: 'prefer_on_device',
    chunks: 1,
    maskForCloud: false,
    reason: deviceReady
      ? 'Public page that fits on-device, and Gemini Nano is ready: fast, free, offline-capable.'
      : `Public page; ${nanoReason(i.nano)}, so Firebase AI Logic falls back to the cloud model.`,
  };
}
