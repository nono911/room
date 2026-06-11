import type { ElectronAPI } from '../../../shared/ipc/contract.js';


declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};

