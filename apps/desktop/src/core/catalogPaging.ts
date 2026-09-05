import type { CatalogRequest, CatalogWithFiltersState, CoreAction } from './types';

interface PagingCore {
  dispatch(action: CoreAction, field: string, hash: string): void;
  getState(): CatalogWithFiltersState;
}

interface PageStep {
  captured: boolean;
  request: CatalogRequest;
  response: { revision: number; empty: boolean; failed: boolean } | null;
  next: boolean;
  resolve(state: CatalogWithFiltersState): void;
  reject(error: Error): void;
}

const nextPage: CoreAction = {
  action: 'CatalogWithFilters',
  args: { action: 'LoadNextPage' },
};
const pageError = () => new Error('The next catalog page could not be loaded.');

// Core's web serializer combines successful pages and hides later-page errors.
// Keep paging status beside that snapshot; Core still owns offsets and deduplication.
export class CatalogPaging {
  private core: PagingCore;
  private notify: () => void;
  private generation = 0;
  private revision = 0;
  private pages = 1;
  private retryTarget: number | null = null;
  private step: PageStep | null = null;
  private operation: Promise<void> | null = null;
  private retained: CatalogWithFiltersState | null = null;
  private loading = false;
  private error = false;

  constructor(core: PagingCore, notify: () => void) {
    this.core = core;
    this.notify = notify;
  }

  reset() {
    this.generation += 1;
    const step = this.step;
    this.step = null;
    step?.reject(new DOMException('Catalog selection changed.', 'AbortError'));
    this.operation = null;
    this.retained = null;
    this.pages = 1;
    this.retryTarget = null;
    this.loading = false;
    this.error = false;
  }

  snapshot(state: CatalogWithFiltersState): CatalogWithFiltersState {
    return {
      ...(this.retained ?? state),
      paging: { loading: this.loading, error: this.error },
    };
  }

  updated() {
    const revision = ++this.revision;
    // Read after the runtime releases the model lock used to emit NewState.
    queueMicrotask(() => {
      const step = this.step;
      if (!step?.response || revision <= step.response.revision) return;
      let state: CatalogWithFiltersState;
      try {
        state = this.core.getState();
      } catch {
        this.step = null;
        step.reject(pageError());
        return;
      }
      const failed =
        step.response.failed ||
        state.catalog?.content?.type !== 'Ready' ||
        (step.next && !step.response.empty && !state.selectable?.nextPage);
      this.step = null;
      if (failed) step.reject(pageError());
      else step.resolve(state);
    });
  }

  observeFetch(fetchRequest: typeof fetch): typeof fetch {
    return async (input, init) => {
      const step = this.step;
      const url = new URL(input instanceof Request ? input.url : String(input));
      const base = step ? new URL('.', step.request.base) : null;
      const path = step?.request.path;
      const prefix =
        base && path
          ? `${base.pathname}${path.resource}/${encodeURIComponent(path.type)}/${encodeURIComponent(path.id)}`
          : null;
      const matches =
        step &&
        !step.captured &&
        url.origin === base?.origin &&
        (url.pathname === `${prefix}.json` || url.pathname.startsWith(`${prefix}/`));
      if (!matches) return fetchRequest(input, init);
      step.captured = true;
      let response: Response;
      try {
        response = await fetchRequest(input, init);
      } catch {
        response = new Response(null, { status: 502 });
      }
      let empty = false;
      let failed = !response.ok;
      if (response.ok) {
        try {
          const body: unknown = await response.clone().json();
          const metas = body && typeof body === 'object' ? Reflect.get(body, 'metas') : null;
          failed = !Array.isArray(metas);
          empty = Array.isArray(metas) && metas.length === 0;
        } catch {
          failed = true;
        }
      }
      if (this.step === step) step.response = { revision: this.revision, empty, failed };
      return response;
    };
  }

  loadNext(hash: string): Promise<void> {
    if (this.operation) return this.operation;
    const state = this.core.getState();
    const request = state.selected?.request;
    const retry = this.error;
    if (!request || (!retry && !state.selectable?.nextPage)) return Promise.resolve();
    const generation = this.generation;
    const targetPages = this.retryTarget ?? this.pages + 1;
    this.retryTarget = targetPages;
    this.retained ??= state;
    this.loading = true;
    this.error = false;
    this.notify();
    this.operation = (async () => {
      try {
        if (retry) {
          this.core.dispatch({ action: 'Unload' }, 'discover', hash);
          await this.loadStep(request, false, hash);
          if (generation !== this.generation) return;
          this.pages = 1;
        }
        while (this.pages < targetPages && this.core.getState().selectable?.nextPage) {
          await this.loadStep(request, true, hash);
          if (generation !== this.generation) return;
          this.pages += 1;
        }
        if (generation === this.generation) {
          this.retained = null;
          this.retryTarget = null;
        }
      } catch (error) {
        if (generation !== this.generation) return;
        this.error = true;
        throw error;
      } finally {
        if (generation === this.generation) {
          this.loading = false;
          this.operation = null;
          this.notify();
        }
      }
    })();
    return this.operation;
  }

  private loadStep(request: CatalogRequest, next: boolean, hash: string) {
    return new Promise<CatalogWithFiltersState>((resolve, reject) => {
      this.step = { captured: false, request, response: null, next, resolve, reject };
      try {
        this.core.dispatch(
          next
            ? nextPage
            : {
                action: 'Load',
                args: { model: 'CatalogWithFilters', args: { request } },
              },
          'discover',
          hash,
        );
      } catch {
        this.step = null;
        reject(pageError());
      }
    });
  }
}
