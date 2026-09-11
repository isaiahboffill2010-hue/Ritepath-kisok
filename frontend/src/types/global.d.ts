export {};

declare global {
  interface Window {
    ritepath?: {
      openExternal: (url: string) => Promise<void>;
      openGoogle: (url: string) => Promise<void>;
      closeGoogle: () => Promise<void>;
      openFileViewer: (file: {
        rootId: string;
        path: string;
        name: string;
        previewKind: string;
        mimeType?: string | null;
        subtitle?: string;
      }) => Promise<void>;
      onGoHome: (callback: () => void) => () => void;
      onOpenDrawer: (callback: () => void) => () => void;
    };
  }
}
