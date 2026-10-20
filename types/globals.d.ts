/* What the browser-global modules hang off window, for the type check
   (npm run typecheck). The app's own namespace is left untyped for now:
   each file is checked on its own terms, and D.* is `any` between them. */
interface Window {
  DPO: any;
  __TAURI_INTERNALS__?: any;
  pdfjsLib?: any;
  math?: any;
  MathJax?: any;
  /* the File System Access API's Save dialog (Chromium only, so not in the DOM lib yet) */
  showSaveFilePicker?: (opts?: {
    suggestedName?: string; id?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<{ name: string; createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
}
