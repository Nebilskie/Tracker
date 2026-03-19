require('./rt/electron-rt');
//////////////////////////////
// User Defined Preload scripts below
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getDeviceId: () => ipcRenderer.invoke('get-device-id'),
});

console.log('User Preload!');
