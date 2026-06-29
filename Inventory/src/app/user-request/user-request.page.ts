import { Component, OnInit } from '@angular/core';
import { ItRequestService } from '../services/it-request.service';
import { ModalController, AlertController } from '@ionic/angular';
import { SubmitRequestModalComponent } from '../it-request/submit-request-modal/submit-request-modal.component';

interface RequestItem {
  id?: number;
  title: string;
  ownerInitials: string;
  username?: string;
  reason?: string;
  status: 'new' | 'inprogress' | 'completed' | 'rejected' | 'pending';
  time: string;
  date: string;
  inprogressAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  pendingAt?: string;
  rejectedFrom?: 'new' | 'inprogress' | null;
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
    { label: 'Rejected', status: 'rejected' },
    { label: 'Pending', status: 'pending' }
  ];

  requests: RequestItem[] = [];
  currentUser: UserData | null = null;

  selectedRequest: RequestItem | null = null;
  showDetailModal = false;

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

      const uid = Number(this.currentUser.id);

      this.itRequestService.getAllRequests().subscribe({
        next: (response: any) => {
          if (response?.success && Array.isArray(response.requests)) {
            this.requests = response.requests
              .filter((req: any) => uid === Number(req.user_id))
              .map((req: any) => ({
                id: req.id,
                title: req.request_text,
                ownerInitials: this.getInitials(req.username),
                username: req.username,
                reason: req.reason || '',
                status: this.mapStatus(req.status),
                time: new Date(req.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                }),
                date: new Date(req.created_at).toLocaleDateString(),
                inprogressAt: req.inprogress_at
                  ? new Date(req.inprogress_at).toLocaleString()
                  : undefined,
                completedAt: req.completed_at
                  ? new Date(req.completed_at).toLocaleString()
                  : undefined,
                rejectedAt: req.rejected_at
                  ? new Date(req.rejected_at).toLocaleString()
                  : undefined,
                pendingAt: req.pending_at
                  ? new Date(req.pending_at).toLocaleString()
                  : undefined,
                rejectedFrom: req.rejected_from || null
              }));

            console.log('My requests loaded:', this.requests.length);
          }
          resolve();
        },
        error: (error) => {
          console.error('Error loading requests:', error);
          reject(error);
        }
      });
    });
  }

  mapStatus(dbStatus: string): RequestItem['status'] {
    switch (dbStatus) {
      case 'N':
        return 'new';
      case 'I':
        return 'inprogress';
      case 'C':
        return 'completed';
      case 'R':
        return 'rejected';
      case 'P':
        return 'pending';
      case 'new':
        return 'new';
      case 'inprogress':
        return 'inprogress';
      case 'completed':
        return 'completed';
      case 'rejected':
        return 'rejected';
      case 'pending':
        return 'pending';
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
    return parts
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  openRequestDetail(request: RequestItem) {
    this.selectedRequest = request;
    this.showDetailModal = true;
  }

  closeDetailModal() {
    this.selectedRequest = null;
    this.showDetailModal = false;
  }

  formatStatusLabel(status: string): string {
    switch (status) {
      case 'new':
        return 'New';
      case 'inprogress':
        return 'In Progress';
      case 'completed':
        return 'Completed';
      case 'rejected':
        return 'Rejected';
      case 'pending':
        return 'Pending';
      default:
        return status;
    }
  }

  async addRequest() {
    if (!this.currentUser) {
      await this.showAlert('Error', 'User not logged in. Please log in first.');
      return;
    }

    const modal = await this.modalController.create({
      component: SubmitRequestModalComponent,
      cssClass: 'request-modal-container',
      showBackdrop: false
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data?.roomId && data?.cubicleNumber && data?.peripheral) {
      this.submitRequest(
        `${data.peripheral} for Cubicle ${data.cubicleNumber} in Room ${data.roomName || data.roomId}${data.buildingName ? ` (${data.buildingName})` : ''}`,
        data.reason || ''
      );
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
      .subscribe({
        next: async (response: any) => {
          if (response?.success) {
            await this.showAlert('Success', 'Request created successfully!');
            await this.loadRequests();
          } else {
            await this.showAlert('Error', 'Failed to create request.');
          }
        },
        error: async (error) => {
          console.error('Error creating request:', error);
          await this.showAlert('Error', 'Server error while creating request.');
        }
      });
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
