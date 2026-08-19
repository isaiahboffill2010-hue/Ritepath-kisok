export {};

declare global {
  interface Window {
    ritepath?: {
      openExternal: (url: string) => Promise<void>;
    };
  }
}
