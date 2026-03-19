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
        id = crypto.randomUUID();
        localStorage.setItem('device-id', id);
      }
      this.deviceId = id;
    }

    return this.deviceId;
  }
}

