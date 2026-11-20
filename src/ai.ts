// Firebase AI Logic hybrid inference. Every model call in CiteReady goes
// through runJson(), which builds a GenerativeModel with BOTH on-device params
// (Chrome Prompt API / Gemini Nano) and in-cloud params (Gemini), then reads
// response.inferenceSource to record where the call actually ran.

import { getGenerativeModel, InferenceMode, InferenceSource, type GenerativeModel } from 'firebase/ai';
import { ai } from './firebase';
import { parseJsonLoose } from './checklist';
import type { Mode, NanoState } from './router';
import { toCloudSchema } from './prompts';

const TEXT_EN = [{ type: 'text' as const, languages: ['en'] }];

export interface DeviceInfo {
  nano: NanoState;
  chromeVersion: number | null;
  hasPromptApi: boolean;
}

interface LanguageModelLike {
  availability(opts?: unknown): Promise<string>;
}

function lm(): LanguageModelLike | undefined {
  return (self as unknown as { LanguageModel?: LanguageModelLike }).LanguageModel;
}

export async function probeDevice(): Promise<DeviceInfo> {
  const m = navigator.userAgent.match(/Chrome\/(\d+)/);
  const chromeVersion = m ? Number(m[1]) : null;
  const LM = lm();
  if (!LM) return { nano: 'no-api', chromeVersion, hasPromptApi: false };
  try {
    const a = await LM.availability({ expectedInputs: TEXT_EN, expectedOutputs: TEXT_EN });
    const nano = (['available', 'downloadable', 'downloading', 'unavailable'].includes(a) ? a : 'unavailable') as NanoState;
    return { nano, chromeVersion, hasPromptApi: true };
  } catch {
    return { nano: 'unavailable', chromeVersion, hasPromptApi: true };
  }
}

const MODE: Record<Mode, InferenceMode> = {
  prefer_on_device: InferenceMode.PREFER_ON_DEVICE,
  only_on_device: InferenceMode.ONLY_ON_DEVICE,
  only_in_cloud: InferenceMode.ONLY_IN_CLOUD,
  prefer_in_cloud: InferenceMode.PREFER_IN_CLOUD,
};

const models = new Map<string, GenerativeModel>();

/** One model instance per (step, mode, cloud model): config is fixed per instance. */
export function hybridModel(opts: {
  key: string;
  mode: Mode;
  system: string;
  schema: Record<string, unknown>;
  cloudModel: string;
}): GenerativeModel {
  const k = `${opts.key}|${opts.mode}|${opts.cloudModel}`;
  const cached = models.get(k);
  if (cached) return cached;
  const model = getGenerativeModel(ai, {
    mode: MODE[opts.mode],
    onDeviceParams: {
      createOptions: {
        expectedInputs: TEXT_EN,
        expectedOutputs: TEXT_EN,
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: opts.system }] }],
      },
      // Structured output on-device: Chrome Prompt API responseConstraint.
      promptOptions: { responseConstraint: opts.schema },
    },
    inCloudParams: {
      model: opts.cloudModel,
      systemInstruction: opts.system,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        // Structured output in the cloud: Gemini responseSchema.
        responseSchema: toCloudSchema(opts.schema) as never,
      },
    },
  });
  models.set(k, model);
  return model;
}

export type Source = 'on_device' | 'in_cloud';

export interface StepLog {
  step: string;
  mode: Mode;
  source: Source;
  ms: number;
  chars: number;
  model: string;
}

export async function runJson(opts: {
  step: string;
  key: string;
  mode: Mode;
  system: string;
  schema: Record<string, unknown>;
  cloudModel: string;
  prompt: string;
}): Promise<{ data: unknown; log: StepLog }> {
  const model = hybridModel(opts);
  const t0 = performance.now();
  const result = await model.generateContent(opts.prompt);
  const ms = Math.round(performance.now() - t0);
  const source: Source = result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'on_device' : 'in_cloud';
  const data = parseJsonLoose(result.response.text());
  return {
    data,
    log: {
      step: opts.step,
      mode: opts.mode,
      source,
      ms,
      chars: opts.prompt.length + opts.system.length,
      model: source === 'on_device' ? 'Gemini Nano (Chrome built-in)' : opts.cloudModel,
    },
  };
}

/**
 * Downloads / warms up Gemini Nano. Must be called from a user gesture.
 * Uses a throwaway PREFER_ON_DEVICE model; Chrome shares the download.
 */
export async function prepareNano(cloudModel: string, onProgress: (p: number) => void): Promise<void> {
  const m = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: { createOptions: { expectedInputs: TEXT_EN, expectedOutputs: TEXT_EN } },
    inCloudParams: { model: cloudModel },
  });
  await m.initializeDeviceModel(onProgress);
}
