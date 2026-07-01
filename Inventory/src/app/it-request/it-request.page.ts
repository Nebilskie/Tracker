import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ItRequestService } from '../services/it-request.service';
import { InventoryService, InventorySummaryItem, InventoryItem } from '../services/inventory.service';
import { ModalController, AlertController } from '@ionic/angular';
import { SubmitRequestModalComponent } from './submit-request-modal/submit-request-modal.component';
import { AutoRefreshService } from '../services/auto-refresh.service';

interface RequestItem {
  id?: number;
  title: string;
  ownerInitials: string;
  username?: string;
  reason?: string;
  rejectedReason?: string;
  status: 'new' | 'inprogress' | 'completed' | 'rejected' | 'pending';
  time: string;
  date: string;
  inprogressAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  pendingAt?: string;
  rejectedFrom?: 'new' | 'inprogress' | null;
  inventory_item_id?: number | null;
  inventory_item_name?: string | null;
  previous_inventory_item_name?: string | null;
  availableItemCount?: number | null;
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
export class ItRequestPage implements OnInit, OnDestroy {

  columns: { label: string; status: RequestItem['status'] }[] = [
    { label: 'New', status: 'new' },
    { label: 'In-Progress', status: 'inprogress' },
    { label: 'Completed', status: 'completed' },
    { label: 'Rejected', status: 'rejected' },
    { label: 'Pending', status: 'pending' }
  ];

  requests: RequestItem[] = [];
  selectedRequest: RequestItem | null = null;
  selectedRequestItemCode = '';
  availableRequestItems: InventoryItem[] = [];
  isSavingItemType = false;
  showDetailModal = false;
  currentUser: UserData | null = null;
  inventorySummary: InventorySummaryItem[] = [];
  private refreshSubscription: Subscription | null = null;

  constructor(
    private itRequestService: ItRequestService,
    private inventoryService: InventoryService,
    private modalController: ModalController,
    private alertController: AlertController,
    private autoRefreshService: AutoRefreshService
  ) {}

  ngOnInit() {
    this.loadCurrentUser();
    this.refreshSubscription = this.autoRefreshService.watch(async () => {
      await this.loadInventorySummary();
      await this.loadRequests();
    });
  }

  ngOnDestroy() {
    this.refreshSubscription?.unsubscribe();
    this.refreshSubscription = null;
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
              rejectedReason: req.rejected_reason || (this.mapStatus(req.status) === 'rejected' ? (req.reason || '') : ''),
              status: this.mapStatus(req.status),
              time: new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              date: new Date(req.created_at).toLocaleDateString(),
              inprogressAt: req.inprogress_at ? new Date(req.inprogress_at).toLocaleString() : undefined,
              completedAt: req.completed_at ? new Date(req.completed_at).toLocaleString() : undefined,
              rejectedAt: req.rejected_at ? new Date(req.rejected_at).toLocaleString() : undefined,
              pendingAt: req.pending_at ? new Date(req.pending_at).toLocaleString() : undefined,
              rejectedFrom: req.rejected_from || null,
              inventory_item_id: req.inventory_item_id ?? null,
              inventory_item_name: req.inventory_item_name || null,
              previous_inventory_item_name: req.previous_inventory_item_name || null,
              availableItemCount: null
            }));
            console.log('✅ Requests loaded:', this.requests.length);

            if (this.selectedRequest?.id) {
              const refreshedRequest = this.requests.find((item) => item.id === this.selectedRequest?.id) || null;
              this.selectedRequest = refreshedRequest;
              if (refreshedRequest) {
                this.selectedRequestItemCode = String(refreshedRequest.inventory_item_name || '').trim();
                this.loadAvailableItemCount(refreshedRequest);
                this.loadAvailableRequestItems(refreshedRequest);
              } else {
                this.closeDetailModal();
              }
            }
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
      case 'N': return 'new';
      case 'I': return 'inprogress';
      case 'C': return 'completed';
      case 'R': return 'rejected';
      case 'P': return 'pending';
      case 'new': return 'new';
      case 'inprogress': return 'inprogress';
      case 'completed': return 'completed';
      case 'rejected': return 'rejected';
      case 'pending': return 'pending';
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

  getRequestDisplayTitle(request: RequestItem | null): string {
    if (!request) return '';
    const completedText = this.getCompletedItemDescription(request);
    return completedText || String(request.title || '');
  }

  getModalRequestTitle(request: RequestItem | null): string {
    return this.getRequestDisplayTitle(request);
  }

  getRequestedItemLabel(request: RequestItem | null): string {
    if (!request) return 'Unknown';

    const itemName = this.extractRequestedItemName(request.title || '').trim();
    if (!itemName) return 'Unknown';

    return itemName.charAt(0).toUpperCase() + itemName.slice(1).toLowerCase();
  }

  getRequestLocationLabel(request: RequestItem | null): string {
    if (!request) return 'Not specified';

    const parts = this.extractLocationParts(request.title || '');
    const locationSegments = [
      parts.cubicle ? `Cubicle ${parts.cubicle}` : '',
      parts.room ? `Room ${parts.room}` : '',
      parts.building ? parts.building : ''
    ].filter(Boolean);

    return locationSegments.length ? locationSegments.join(' · ') : 'Not specified';
  }

  getAssignedItemLabel(request: RequestItem | null): string {
    if (!request) return 'Not assigned yet';

    const itemCode = String(request.inventory_item_name || request.previous_inventory_item_name || '').trim();
    return itemCode || 'Not assigned yet';
  }

  /* =========================
     CLICK + MODAL
  ========================= */
  onCardClick(_status: RequestItem['status'], request: RequestItem) {
    this.openRequestDetail(request);
  }

  async openRequestDetail(request: RequestItem) {
    await this.loadInventorySummary();
    this.selectedRequest = request;
    this.selectedRequestItemCode = String(request.inventory_item_name || '').trim();
    this.loadAvailableRequestItems(request);
    this.showDetailModal = true;
    this.loadAvailableItemCount(request);
  }

  closeDetailModal() {
    this.selectedRequestItemCode = '';
    this.availableRequestItems = [];
    this.selectedRequest = null;
    this.showDetailModal = false;
  }

  private loadInventorySummary(): Promise<void> {
    return new Promise((resolve) => {
      this.inventoryService.getSummary().subscribe(
        (response) => {
          this.inventorySummary = Array.isArray(response?.summary) ? response.summary : [];
          resolve();
        },
        (error) => {
          console.error('Error loading inventory summary:', error);
          this.inventorySummary = [];
          resolve();
        }
      );
    });
  }

  private loadAvailableItemCount(request: RequestItem) {
    if (!request) {
      return;
    }

    const itemName = this.extractRequestedItemName(request.title || '').trim();
    if (!itemName) {
      request.availableItemCount = null;
      return;
    }

    const normalizedTarget = itemName.toLowerCase();
    const match = this.inventorySummary.find((item) => {
      const name = String(item.name || '').toLowerCase();
      return name === normalizedTarget || name.includes(normalizedTarget) || normalizedTarget.includes(name);
    });

    request.availableItemCount = match ? Number(match.available || 0) : null;
  }

  private loadAvailableRequestItems(request: RequestItem) {
    const requestedType = this.extractRequestedItemName(request?.title || '').trim();
    if (!requestedType) {
      this.availableRequestItems = [];
      return;
    }

    this.inventoryService.getItems(requestedType, true, request.id).subscribe(
      (response) => {
        const allItems = Array.isArray(response?.items) ? response.items : [];
        this.availableRequestItems = allItems.filter((item) => {
          const status = Number(item?.status);
          return status === 1;
        });
      },
      (error) => {
        console.error('Error loading available request items:', error);
        this.availableRequestItems = [];
      }
    );
  }

  getRequestItemOptions(): { code: string; label: string }[] {
    return (this.availableRequestItems || [])
      .map((item) => {
        const code = String(item.code || '').trim();
        const location = String(item.location || '').trim();
        return {
          code,
          label: location ? `${code} (${location})` : code
        };
      })
      .filter((item) => !!item.code);
  }

  isItemTypeSelectable(request: RequestItem | null): boolean {
    return !!request && (request.status === 'inprogress' || request.status === 'pending');
  }

  shouldShowAvailability(request: RequestItem | null): boolean {
    return !!request
      && request.availableItemCount !== null
      && request.status !== 'completed';
  }

  onSelectedItemTypeChange(itemCode: string) {
    this.selectedRequestItemCode = itemCode;
    if (!this.selectedRequest || !itemCode || this.isSavingItemType) {
      return;
    }
    this.saveRequestItemType(this.selectedRequest, itemCode);
  }

  private async saveRequestItemType(request: RequestItem, itemCode: string) {
    if (!request?.id) {
      await this.showAlert('Error', 'Request ID not found');
      return;
    }

    this.isSavingItemType = true;
    this.itRequestService.updateRequestItemType(request.id, itemCode).subscribe(
      async (response: any) => {
        this.isSavingItemType = false;
        if (!response?.success) {
          await this.showAlert('Error', 'Failed to update requested item');
          return;
        }

        request.inventory_item_id = response?.itemId ?? request.inventory_item_id ?? null;
        request.inventory_item_name = response?.itemCode || itemCode;
        await this.loadInventorySummary();
        this.loadAvailableItemCount(request);

        await this.loadRequests();
        if (this.selectedRequest?.id === request.id) {
          const refreshed = this.requests.find((r) => r.id === request.id) || request;
          this.selectedRequest = refreshed;
          this.selectedRequestItemCode = String(refreshed.inventory_item_name || '').trim();
          this.loadAvailableRequestItems(refreshed);
          this.loadAvailableItemCount(refreshed);
        }
      },
      async (error) => {
        this.isSavingItemType = false;
        console.error('Error updating request item type:', error);
        await this.showAlert('Error', 'Failed to update requested item. Please try again.');
      }
    );
  }

  extractRequestedItemName(text: string): string {
    const value = String(text || '').trim();
    const lowercase = value.toLowerCase();
    const match = lowercase.match(/^([a-z0-9]+)(?:\s+for|\s+request|\s+to|\s+in|$)/);
    if (match && match[1]) {
      return match[1];
    }
    const firstWord = value.split(/\s+/)[0] || '';
    return firstWord;
  }

  getCompletedItemDescription(request: RequestItem | null): string {
    if (!request || request.status !== 'completed') {
      return '';
    }

    const itemTypeRaw = this.extractRequestedItemName(request.title || '').trim();
    const itemType = itemTypeRaw
      ? itemTypeRaw.charAt(0).toUpperCase() + itemTypeRaw.slice(1).toLowerCase()
      : 'Item';

    const itemCode = String(request.inventory_item_name || request.previous_inventory_item_name || '').trim();
    if (!itemCode) {
      return '';
    }

    const parsed = this.extractLocationParts(request.title || '');
    const locationText = [
      parsed.cubicle ? `for ${parsed.cubicle}` : '',
      parsed.room ? `from ${parsed.room}` : '',
      parsed.building ? `in ${parsed.building}` : ''
    ]
      .filter(Boolean)
      .join(' ');

    return locationText
      ? `${itemType}: ${itemCode} ${locationText}`
      : `${itemType}: ${itemCode}`;
  }

  private extractLocationParts(text: string): { cubicle: string; room: string; building: string } {
    const value = String(text || '').trim();
    const match = value.match(/for\s+Cubicle\s+(.+?)\s+in\s+Room\s+(.+?)(?:\s*\((.+?)\))?$/i);
    if (!match) {
      return { cubicle: '', room: '', building: '' };
    }

    return {
      cubicle: String(match[1] || '').trim(),
      room: String(match[2] || '').trim(),
      building: String(match[3] || '').trim()
    };
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

  async pendingRequest(request: RequestItem) {
    if (!request?.id) {
      await this.showAlert('Error', 'Request ID not found');
      return;
    }
    await this.updateStatus(request.id, 'pending', 'Request moved to Pending');
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

    const rejectionReason = await this.promptRejectionReason();
    if (rejectionReason === null) {
      return;
    }

    await this.updateStatus(request.id, 'rejected', 'Request rejected', rejectionReason);
  }

  private async updateStatus(
    id: number,
    status: RequestItem['status'],
    successMsg: string,
    rejectionReason: string = ''
  ) {
    this.itRequestService.updateRequestStatus(id, status, rejectionReason).subscribe(
      async (response: any) => {
        if (response?.success) {
          await this.showAlert('Success', successMsg);
          await this.loadInventorySummary();
          await this.loadRequests();
          this.closeDetailModal();
        } else {
          await this.showAlert('Error', 'Failed to update request');
        }
      },
      async (error) => {
        console.error('❌ HTTP Error updating request:', error);
        await this.showAlert('Error', error?.error?.error || 'Failed to update request. Please try again.');
      }
    );
  }

  private async promptRejectionReason(): Promise<string | null> {
    let capturedReason: string | null = null;

    const alert = await this.alertController.create({
      header: 'Reject Request',
      message: 'Please provide a reason for rejecting this request.',
      inputs: [
        {
          name: 'rejectionReason',
          type: 'textarea',
          placeholder: 'Type rejection reason...'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Reject',
          handler: (data) => {
            const value = String(data?.rejectionReason || '').trim();
            if (!value) {
              this.showAlert('Required', 'Rejection reason is required.');
              return false;
            }
            capturedReason = value;
            return true;
          }
        }
      ]
    });

    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role === 'cancel') {
      return null;
    }

    return capturedReason;
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
      showBackdrop: false,
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data && data.roomId && data.cubicleNumber && data.peripheral) {
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
      case 'pending': return 'Pending';
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