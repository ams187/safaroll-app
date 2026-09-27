import { uiLanguage } from '@/i18n/current';
import { plainT } from '@/i18n/plain';
import { supabase } from './supabase/client';
import type { SafariRun } from '../../supabase/functions/_shared/safari';
export type { SafariRun, SafariOffer, SafariSite } from '../../supabase/functions/_shared/safari';
export type SafariStatus = { active: SafariRun | null; history: SafariRun[] };

export async function safariRequest<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  // The server answers in this language (species names, titles, errors).
  const { data, error } = await supabase.functions.invoke('safari', { body: { ...payload, action, locale: uiLanguage() }, timeout: 20_000 });
  if (error) {
    const response = 'context' in error ? error.context : null;
    const body = response instanceof Response ? await response.json().catch(() => null) : null;
    throw new Error(body?.error ?? plainT('safari_service_unavailable'));
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
