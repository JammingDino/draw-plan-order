/* Stand-in for the vendored pdf.js, just enough to exercise the caching,
   scheduling and cancellation logic in js/pdf.js. */
export const GlobalWorkerOptions = { workerSrc: null };

export const stats = { renders: 0, cancels: 0, completed: 0, getPages: 0 };
export let renderDelayMs = 5;
export function setRenderDelay(ms) { renderDelayMs = ms; }

export function getDocument(opts) {
  const numPages = globalThis.__FAKE_PAGES__ ?? 150;
  return {
    promise: Promise.resolve({
      numPages,
      async getPage(n) {
        stats.getPages++;
        return {
          getViewport({ scale }) { return { width: 595 * scale, height: 842 * scale }; },
          render({ viewport }) {
            stats.renders++;
            let cancelled = false;
            let settle;
            const promise = new Promise((res, rej) => { settle = { res, rej }; });
            const t = setTimeout(() => {
              if (cancelled) return;
              stats.completed++;
              settle.res();
            }, renderDelayMs);
            return {
              promise,
              cancel() {
                if (cancelled) return;
                cancelled = true; stats.cancels++;
                clearTimeout(t);
                const e = new Error("Rendering cancelled");
                e.name = "RenderingCancelledException";
                settle.rej(e);
              },
            };
          },
        };
      },
    }),
  };
}
