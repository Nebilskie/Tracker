import { Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  constructor(private toastCtrl: ToastController) {}

  async show(message: string, duration = 3000) {
    try {
      const t = await this.toastCtrl.create({
        message: String(message || ''),
        duration,
        position: 'top',
        color: 'primary',
        cssClass: 'app-toast'
      });
      await t.present();
    } catch (e) {
      console.log('Toast fallback:', message);
    }
  }
}
