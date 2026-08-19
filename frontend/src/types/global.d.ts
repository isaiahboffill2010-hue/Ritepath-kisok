export {};

declare global {
  interface Window {
    ritepath?: {
      openExternal: (url: string) => Promise<void>;
      openGoogle: (url: string) => Promise<void>;
      closeGoogle: () => Promise<void>;
      onOpenDrawer: (callback: () => void) => () => void;
    };
  }
}
