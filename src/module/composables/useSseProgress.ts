import { onBeforeUnmount, ref } from 'vue';
import type { ProgressEvent } from '../types';
import { useSeedApi } from './useSeedApi';

/**
 * Progress for the current run, whichever engine produced it.
 *
 * With the API extension the events arrive over SSE; in app-only mode they come
 * straight from the in-tab engine. The component does not need to know which.
 */
export function useSseProgress() {
  const api = useSeedApi();

  const events = ref<ProgressEvent[]>([]);
  const latest = ref<ProgressEvent | null>(null);
  const done = ref(false);
  const cancelled = ref(false);
  const error = ref<string | null>(null);

  let unsubscribe: (() => void) | null = null;

  async function start(runId: string) {
    stop();
    events.value = [];
    latest.value = null;
    done.value = false;
    cancelled.value = false;
    error.value = null;

    unsubscribe = await api.progress(runId, (event) => {
      events.value = [...events.value, event];
      latest.value = event;

      if (event.type === 'complete') {
        done.value = true;
        stop();
      }
      if (event.type === 'cancelled') {
        cancelled.value = true;
        done.value = true;
        stop();
      }
      if (event.type === 'error') {
        error.value = event.message ?? 'Generation failed';
        done.value = true;
        stop();
      }
    });
  }

  function stop() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  onBeforeUnmount(stop);

  return { events, latest, done, cancelled, error, start, stop };
}
