export {};

declare global {
  interface Window {
    electronAPI?: {
      getDeviceId: () => Promise<string>;
    };
  }
}

