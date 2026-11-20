import { describe, expect, it } from 'vitest';
import { decideRoute, type RouteInput } from '../src/router';

const base: RouteInput = {
  sensitivity: 'private',
  chars: 2000,
  nano: 'available',
  maxDeviceChars: 12000,
  maxPrivateChunks: 6,
  override: 'auto',
  cloudConsent: false,
  maskContactsForCloud: true,
};

describe('decideRoute', () => {
  it('keeps a short private draft on-device only', () => {
    const r = decideRoute(base);
    expect(r.plan).toBe('on-device');
    expect(r.factsMode).toBe('only_on_device');
    expect(r.kitMode).toBe('only_on_device');
  });

  it('chunks a long private draft on-device instead of uploading it', () => {
    const r = decideRoute({ ...base, chars: 30000 });
    expect(r.plan).toBe('on-device-chunked');
    expect(r.chunks).toBe(3);
    expect(r.factsMode).toBe('only_on_device');
  });

  it('never silently uploads a private draft when Nano is missing', () => {
    for (const nano of ['no-api', 'unavailable', 'downloadable', 'downloading'] as const) {
      const r = decideRoute({ ...base, nano });
      expect(r.plan).toBe('needs-consent');
    }
  });

  it('uploads a masked private draft only after consent', () => {
    const r = decideRoute({ ...base, nano: 'no-api', cloudConsent: true });
    expect(r.plan).toBe('cloud');
    expect(r.factsMode).toBe('only_in_cloud');
    expect(r.maskForCloud).toBe(true);
  });

  it('asks for consent when a private draft needs too many on-device parts', () => {
    const r = decideRoute({ ...base, chars: 12000 * 7 });
    expect(r.plan).toBe('needs-consent');
    const ok = decideRoute({ ...base, chars: 12000 * 7, cloudConsent: true });
    expect(ok.factsMode).toBe('only_in_cloud');
    expect(ok.kitMode).toBe('only_on_device');
  });

  it('prefers on-device for a short public page and lets the SDK fall back', () => {
    expect(decideRoute({ ...base, sensitivity: 'public' }).factsMode).toBe('prefer_on_device');
    const r = decideRoute({ ...base, sensitivity: 'public', nano: 'no-api' });
    expect(r.plan).toBe('prefer-on-device');
    expect(r.factsMode).toBe('prefer_on_device');
  });

  it('sends a long public page to the cloud but keeps the short kit step on-device-first', () => {
    const r = decideRoute({ ...base, sensitivity: 'public', chars: 40000 });
    expect(r.factsMode).toBe('only_in_cloud');
    expect(r.kitMode).toBe('prefer_on_device');
    expect(r.maskForCloud).toBe(false);
  });

  it('respects overrides but still guards private drafts', () => {
    expect(decideRoute({ ...base, override: 'cloud' }).plan).toBe('needs-consent');
    expect(decideRoute({ ...base, override: 'cloud', cloudConsent: true }).plan).toBe('cloud');
    expect(decideRoute({ ...base, sensitivity: 'public', override: 'cloud' }).factsMode).toBe('only_in_cloud');
    expect(decideRoute({ ...base, override: 'device', nano: 'no-api' }).plan).toBe('needs-device');
  });
});
