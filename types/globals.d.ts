/* What the browser-global modules hang off window, for the type check
   (npm run typecheck). The app's own namespace is left untyped for now:
   each file is checked on its own terms, and D.* is `any` between them. */
interface Window {
  DPO: any;
  __TAURI_INTERNALS__?: any;
  pdfjsLib?: any;
  math?: any;
  MathJax?: any;
}
