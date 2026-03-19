import { Component, OnInit } from '@angular/core';
import { ItRequestService } from '../services/it-request.service';
import { ModalController, AlertController } from '@ionic/angular';
import { SubmitRequestModalComponent } from '../it-request/submit-request-modal/submit-request-modal.component';

interface RequestItem {
  id?: number;
  title: string;
  ownerInitials: string;
  username?: string;
  status: 'new' | 'inprogress' | 'completed' | 'rejected';
  time: string;
  date: string;
}

interface UserData {
  id: number;
  username: string;
  role: string;
}

@Component({
  selector: 'app-user-request',
  templateUrl: './user-request.page.html',
  styleUrls: ['./user-request.page.scss'],
  standalone: false
})
export class UserRequestPage implements OnInit {
  columns: { label: string; status: RequestItem['status'] }[] = [
    { label: 'New', status: 'new' },
    { label: 'In-Progress', status: 'inprogress' },
    { label: 'Completed', status: 'completed' },
    { label: 'Rejected', status: 'rejected' }
  ];

  requests: RequestItem[] = [];
  currentUser: UserData | null = null;

  constructor(
    private itRequestService: ItRequestService,
    private modalController: ModalController,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    this.loadCurrentUser();
    this.loadRequests();
  }

  loadCurrentUser() {
    const userStr = localStorage.getItem('user');
    if (!userStr) return;

    try {
      this.currentUser = JSON.parse(userStr);
    } catch (error) {
      console.error('Error loading user data:', error);
      this.currentUser = null;
    }
  }

  loadRequests(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.currentUser) {
        this.requests = [];
        resolve();
        return;
      }

      this.itRequestService.getAllRequests().subscribe(
        (response: any) => {
          if (response?.success && Array.isArray(response.requests)) {
            const userId = this.currentUser?.id;
            this.requests = response.requests
              .filter((req: any) => req.user_id === userId)
              .map((req: any) => ({
                id: req.id,
                title: req.request_text,
                ownerInitials: this.getInitials(req.username),
                username: req.username,
                status: this.mapStatus(req.status),
                time: new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                date: new Date(req.created_at).toLocaleDateString()
              }));

            console.log('✅ My requests loaded:', this.requests.length);
          }
          resolve();
        },
        (error) => {
          console.error('Error loading requests:', error);
          reject(error);
        }
      );
    });
  }

  mapStatus(dbStatus: string): RequestItem['status'] {
    switch (dbStatus) {
      case 'new':
        return 'new';
      case 'inprogress':
        return 'inprogress';
      case 'completed':
        return 'completed';
      case 'rejected':
        return 'rejected';
      default:
        return 'new';
    }
  }

  itemsByStatus(status: RequestItem['status']) {
    return this.requests.filter((r) => r.status === status);
  }

  getInitials(username: string): string {
    if (!username) return 'UN';
    const parts = username.trim().split(' ').filter(Boolean);
    return parts.map((p) => p[0]).join('').toUpperCase().substring(0, 2);
  }

  async addRequest() {
    if (!this.currentUser) {
      await this.showAlert('Error', 'User not logged in. Please log in first.');
      return;
    }

    const modal = await this.modalController.create({
      component: SubmitRequestModalComponent,
      cssClass: 'request-modal-container',
      presentingElement: await this.modalController.getTop()
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data && data.cubicleNumber && data.peripheral) {
      this.submitRequest(`${data.peripheral} for Cubicle ${data.cubicleNumber}`, data.reason || '');
    }
  }

  submitRequest(requestText: string, reason: string = '') {
    if (!this.currentUser?.username) {
      this.showAlert('Error', 'User information not available. Please log in again.');
      return;
    }

    const userId = this.currentUser.id ?? 1;

    this.itRequestService
      .createRequest(userId, this.currentUser.username, requestText, reason)
      .subscribe(
        async (response: any) => {
          if (response?.success) {
            await this.showAlert('Success', 'Request created successfully!');
            await this.loadRequests();
          } else {
            await this.showAlert('Error', 'Failed to create request.');
          }
        },
        async (error) => {
          console.error('Error creating request:', error);
          await this.showAlert('Error', 'Server error while creating request.');
        }
      );
  }

  async showAlert(header: string, message: string) {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK']
    });
    await alert.present();
  }
}
