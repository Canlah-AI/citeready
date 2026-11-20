// Firebase setup: App, App Check (required by Firebase AI Logic), Remote Config
// (routing policy), and the AI Logic instance with the Gemini Developer API backend.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';

const env = import.meta.env;

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
});

// App Check. Local development uses a debug token (never shipped in production
// builds); the hosted app uses reCAPTCHA Enterprise.
if (env.DEV) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    env.VITE_APPCHECK_DEBUG_TOKEN || true;
}
initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

// Firebase AI Logic, Gemini Developer API backend (works on the free Spark plan).
export const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

export interface Policy {
  cloudModel: string;
  maxDeviceChars: number;
  maxPrivateChunks: number;
  maskContactsForCloud: boolean;
  promptVersion: string;
  source: 'remote' | 'default';
}

const DEFAULTS = {
  cloud_model: 'gemini-3.5-flash-lite',
  on_device_max_chars: 12000,
  max_private_chunks: 6,
  mask_contacts_for_cloud: true,
  prompt_version: 'v1',
};

const rc = getRemoteConfig(firebaseApp);
rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
rc.settings.fetchTimeoutMillis = 5000;
rc.defaultConfig = DEFAULTS;

function readPolicy(source: Policy['source']): Policy {
  const num = (k: string, d: number) => {
    const v = getValue(rc, k).asNumber();
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    cloudModel: getValue(rc, 'cloud_model').asString() || DEFAULTS.cloud_model,
    maxDeviceChars: num('on_device_max_chars', DEFAULTS.on_device_max_chars),
    maxPrivateChunks: num('max_private_chunks', DEFAULTS.max_private_chunks),
    maskContactsForCloud: getValue(rc, 'mask_contacts_for_cloud').asBoolean(),
    promptVersion: getValue(rc, 'prompt_version').asString() || DEFAULTS.prompt_version,
    source,
  };
}

/** Routing policy from Remote Config, falling back to built-in defaults offline. */
export async function loadPolicy(): Promise<Policy> {
  try {
    await fetchAndActivate(rc);
    const fromRemote = getValue(rc, 'cloud_model').getSource() === 'remote';
    return readPolicy(fromRemote ? 'remote' : 'default');
  } catch {
    return readPolicy('default');
  }
}
