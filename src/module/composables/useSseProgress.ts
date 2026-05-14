import { onBeforeUnmount, ref } from 'vue';
import type { ProgressEvent } from '../types';

export function useSseProgress() {
  const events = ref<ProgressEvent[]>([]);
  const latest = ref<ProgressEvent | null>(null);
  const done = ref(false);
  const error = ref<string | null>(null);

  let source: EventSource | null = null;

  function start(url: string) {
    stop();
    events.value = [];
    latest.value = null;
    done.value = false;
    error.value = null;

    source = new EventSource(url, { withCredentials: true });

    source.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as ProgressEvent;
        events.value.push(evt);
        latest.value = evt;
        if (evt.type === 'complete') {
          done.value = true;
          stop();
        }
        if (evt.type === 'error') {
          error.value = evt.message ?? 'Generation failed';
          done.value = true;
          stop();
        }
      } catch (err) {
        error.value = 'Failed to parse progress event';
      }
    };

    source.onerror = () => {
      if (!done.value) {
        error.value = 'Lost connection to progress stream';
      }
      stop();
    };
  }

  function stop() {
    if (source) {
      source.close();
      source = null;
    }
  }

  onBeforeUnmount(stop);

  return { events, latest, done, error, start, stop };
}
