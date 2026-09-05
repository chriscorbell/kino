import { t as enUS } from '../locales';
import { isCoreContractFailure } from './adapters';

/**
 * The text for a log. A contract failure keeps its model and field path here,
 * which is the only place that detail is useful.
 */
export function coreFailureDetail(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  // Stremio Core rejects with plain values; keep them legible in the log.
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch {
    /* fall through to the generic message */
  }
  return fallback;
}

/**
 * The text a person reads. Both the provider's initialization failure and an
 * ordinary model read render this directly, so a contract failure has to say
 * something a reader can act on instead of naming a serializer field.
 */
export function coreFailureMessage(error: unknown, fallback: string) {
  return isCoreContractFailure(error)
    ? enUS.errors.coreContract
    : coreFailureDetail(error, fallback);
}
