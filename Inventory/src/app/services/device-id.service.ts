import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DeviceIdService {
  private deviceId: string | null = null;

  async getDeviceId(): Promise<string> {
    if (this.deviceId) {
      return this.deviceId;
    }

    if (window.electronAPI?.getDeviceId) {
      // Running inside Electron — get the persisted device ID from main process
      this.deviceId = await window.electronAPI.getDeviceId();
    } else {
      // Fallback for browser dev mode — use localStorage
      let id = localStorage.getItem('device-id');
      if (!id) {
        id = this.generateUuid();
        localStorage.setItem('device-id', id);
      }
      this.deviceId = id;
    }

    return this.deviceId;
  }

  private generateUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    const cryptoSource =
      typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
        ? crypto
        : { getRandomValues: (arr: Uint8Array) => arr.map(() => Math.floor(Math.random() * 256)) };

    cryptoSource.getRandomValues(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return [...bytes]
      .map((b, i) => ('0' + b.toString(16)).slice(-2) + ([3, 5, 7, 9].includes(i) ? '-' : ''))
      .join('');
  }
}

