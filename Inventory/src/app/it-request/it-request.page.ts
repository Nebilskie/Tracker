import { Component, OnInit } from '@angular/core';
import { ItRequestService } from '../services/it-request.service';
import { FloorplanApiService } from '../services/floorplan-api';
import { ModalController, AlertController } from '@ionic/angular';
import { SubmitRequestModalComponent } from './submit-request-modal/submit-request-modal.component';

interface RequestItem {
  id?: number;
  title: string;
  ownerInitials: string;
  username?: string;
  reason?: string;
  status: 'new' | 'inprogress' | 'completed' | 'rejected';
  time: string;
  date: string;
  inprogressAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  rejectedFrom?: 'new' | 'inprogress' | null;
}

interface UserData {
  id: number;
  username: string;
  role: string;
}

@Component({
  selector: 'app-it-request',
  templateUrl: './it-request.page.html',
  styleUrls: ['./it-request.page.scss'],
  standalone: false
})
export class ItRequestPage implements OnInit {

  columns: { label: string; status: RequestItem['status'] }[] = [
    { label: 'New', status: 'new' },
    { label: 'In-Progress', status: 'inprogress' },
    { label: 'Completed', status: 'completed' },
    { label: 'Rejected', status: 'rejected' }
  ];

  requests: RequestItem[] = [];
  selectedRequest: RequestItem | null = null;
  showDetailModal = false;
  currentUser: UserData | null = null;
  cubicleOptions: string[] = [];

  constructor(
    private itRequestService: ItRequestService,
    private floorplanApi: FloorplanApiService,
    private modalController: ModalController,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    this.loadCurrentUser();
    this.loadCubicleOptions();
    this.loadRequests();
  }

  loadCubicleOptions() {
    if (!this.currentUser?.id) {
      this.cubicleOptions = [];
      return;
    }

    this.floorplanApi.listFloorplans().subscribe(
      (response: any) => {
        if (response?.success && Array.isArray(response.floorplans)) {
          const floorplans = response.floorplans as Array<{ label?: string }>;
          // Collect unique labels for dropdown
          this.cubicleOptions = [...new Set(
            floorplans
              .map((f) => f.label)
              .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
          )];
        } else {
          this.cubicleOptions = [];
        }
      },
      (error) => {
        console.error('Error loading floorplans for cubicle dropdown:', error);
        this.cubicleOptions = [];
      }
    );
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
      this.itRequestService.getAllRequests().subscribe(
        (response: any) => {
          if (response?.success && Array.isArray(response.requests)) {
            this.requests = response.requests.map((req: any) => ({
              id: req.id,
              title: req.request_text,
              ownerInitials: this.getInitials(req.username),
              username: req.username,
              reason: req.reason || '',
              status: this.mapStatus(req.status),
              time: new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              date: new Date(req.created_at).toLocaleDateString(),
              inprogressAt: req.inprogress_at ? new Date(req.inprogress_at).toLocaleString() : undefined,
              completedAt: req.completed_at ? new Date(req.completed_at).toLocaleString() : undefined,
              rejectedAt: req.rejected_at ? new Date(req.rejected_at).toLocaleString() : undefined,
              rejectedFrom: req.rejected_from || null
            }));
            console.log('✅ Requests loaded:', this.requests.length);
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
      case 'new': return 'new';
      case 'inprogress': return 'inprogress';
      case 'completed': return 'completed';
      case 'rejected': return 'rejected';
      default: return 'new';
    }
  }

  itemsByStatus(status: RequestItem['status']) {
    return this.requests.filter(r => r.status === status);
  }

  getInitials(username: string): string {
    if (!username) return 'UN';
    const parts = username.trim().split(' ').filter(Boolean);
    return parts.map(p => p[0]).join('').toUpperCase().substring(0, 2);
  }

  /* =========================
     CLICK + MODAL
  ========================= */
  onCardClick(_status: RequestItem['status'], request: RequestItem) {
    this.openRequestDetail(request);
  }

  openRequestDetail(request: RequestItem) {
    this.selectedRequest = request;
    this.showDetailModal = true;
  }

  closeDetailModal() {
    this.selectedRequest = null;
    this.showDetailModal = false;
  }

  /* =========================
     BUTTON VISIBILITY HELPERS
  ========================= */
  canAccept(r: RequestItem | null): boolean {
    return !!r && r.status === 'new';
  }

  canDone(r: RequestItem | null): boolean {
    return !!r && r.status === 'inprogress';
  }

  canReject(r: RequestItem | null): boolean {
    return !!r && (r.status === 'new' || r.status === 'inprogress');
  }

  /* =========================
     ACTIONS
  ========================= */
  async acceptRequest(request: RequestItem) {
    if (!request?.id) {
      await this.showAlert('Error', 'Request ID not found');
      return;
    }
    await this.updateStatus(request.id, 'inprogress', 'Request accepted → In Progress');
  }

  async doneRequest(request: RequestItem) {
    if (!request?.id) {
      await this.showAlert('Error', 'Request ID not found');
      return;
    }
    await this.updateStatus(request.id, 'completed', 'Request marked as Done → Completed');
  }

  async rejectRequest(request: RequestItem) {
    if (!request?.id) {
      await this.showAlert('Error', 'Request ID not found');
      return;
    }
    await this.updateStatus(request.id, 'rejected', 'Request rejected');
  }

  private async updateStatus(id: number, status: RequestItem['status'], successMsg: string) {
    this.itRequestService.updateRequestStatus(id, status).subscribe(
      async (response: any) => {
        if (response?.success) {
          await this.showAlert('Success', successMsg);
          await this.loadRequests();
          this.closeDetailModal();
        } else {
          await this.showAlert('Error', 'Failed to update request');
        }
      },
      async (error) => {
        console.error('❌ HTTP Error updating request:', error);
        await this.showAlert('Error', 'Failed to update request. Please try again.');
      }
    );
  }

  /* =========================
     CREATE REQUEST
  ========================= */
  async addRequest(_status: RequestItem['status']) {
    if (!this.currentUser) {
      await this.showAlert('Error', 'User not logged in. Please log in first.');
      return;
    }

    const modal = await this.modalController.create({
      component: SubmitRequestModalComponent,
      cssClass: 'request-modal-container',
      presentingElement: await this.modalController.getTop(),
      componentProps: {
        cubicleOptions: this.cubicleOptions
      }
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data && data.cubicleNumber && data.peripheral) {
      this.submitRequest(
        `${data.peripheral} for Cubicle ${data.cubicleNumber}`,
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

    this.itRequestService.createRequest(
      userId,
      this.currentUser.username,
      requestText,
      reason
    ).subscribe(
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

  /* =========================
     UI HELPERS
  ========================= */
  formatStatusLabel(status: string): string {
    switch (status) {
      case 'new': return 'New';
      case 'inprogress': return 'In Progress';
      case 'completed': return 'Completed';
      case 'rejected': return 'Rejected';
      default: return status;
    }
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