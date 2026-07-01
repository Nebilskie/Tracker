import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ItRequestService } from '../services/it-request.service';
import { InventoryService } from '../services/inventory.service';
import { AutoRefreshService } from '../services/auto-refresh.service';

interface RequestItem {
  id?: number;
  title: string;
  status: 'new' | 'inprogress' | 'completed' | 'rejected';
  statusLabel: string;
  statusClass: string;
  time: string;
  date: string;
}

interface UserData {
  id?: number;
  username?: string;
  role?: string;
  cubicle_label?: string;
  building_name?: string;
  room_name?: string;
}

@Component({
  selector: 'app-user-home',
  templateUrl: './user-home.page.html',
  styleUrls: ['./user-home.page.scss'],
  standalone: false
})
export class UserHomePage implements OnInit {
  currentDate = new Date();
  userName = 'User';
  currentUser: UserData | null = null;
  myItemsCount = 0;

  requestCounts = {
    new: 0,
    inProgress: 0,
    completed: 0,
    total: 0
  };

  recentRequests: RequestItem[] = [];
  private refreshSubscription: Subscription | null = null;

  constructor(
    private itRequestService: ItRequestService,
    private inventoryService: InventoryService,
    private router: Router,
    private autoRefreshService: AutoRefreshService
  ) {}

  ngOnInit() {
    this.startAutoRefresh();
  }

  ionViewWillEnter() {
    if (!this.refreshSubscription || this.refreshSubscription.closed) {
      this.startAutoRefresh();
    }
  }

  ngOnDestroy() {
    this.refreshSubscription?.unsubscribe();
    this.refreshSubscription = null;
  }

  private startAutoRefresh() {
    this.refreshSubscription?.unsubscribe();
    this.refreshSubscription = this.autoRefreshService.watch(() => {
      this.loadCurrentUser();
      this.loadRequests();
      this.loadMyItems();
    });
  }

  loadCurrentUser() {
    const raw = localStorage.getItem('user');
    if (!raw) return;

    try {
      const value = JSON.parse(raw);
      this.currentUser = value;
      this.userName = value.username || value.name || this.userName;
    } catch (error) {
      console.error('Failed to parse current user data', error);
    }
  }

  loadRequests() {
    this.itRequestService.getAllRequests().subscribe(
      (response) => {
        if (!response || !response.success || !Array.isArray(response.requests)) {
          this.requestCounts = { new: 0, inProgress: 0, completed: 0, total: 0 };
          this.recentRequests = [];
          return;
        }

        const requests = response.requests as any[];
        const filtered = this.filterRequestsByUser(requests);

        this.requestCounts.total = filtered.length;
        this.requestCounts.new = filtered.filter((req) => this.mapStatus(req.status) === 'new').length;
        this.requestCounts.inProgress = filtered.filter((req) => this.mapStatus(req.status) === 'inprogress').length;
        this.requestCounts.completed = filtered.filter((req) => this.mapStatus(req.status) === 'completed').length;

        this.recentRequests = filtered
          .map((req) => this.normalizeRequest(req))
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 6);
      },
      (error) => {
        console.error('Failed to load requests for dashboard', error);
      }
    );
  }

  private getRequestUserId(req: any): string {
    if (!req) {
      return '';
    }

    return String(req.user_id ?? req.userId ?? '');
  }

  filterRequestsByUser(requests: any[]) {
    if (!this.currentUser || this.currentUser.id === undefined || this.currentUser.id === null) {
      return [];
    }

    const currentUserId = String(this.currentUser.id);
    return requests.filter((req) => this.getRequestUserId(req) === currentUserId);
  }

  normalizeRequest(req: any): RequestItem {
    const status = this.mapStatus(req.status);
    return {
      id: req.id,
      title: req.request_text || req.title || 'Untitled request',
      status,
      statusLabel: this.formatStatusLabel(status),
      statusClass: this.getStatusBadgeClass(status),
      time: this.formatTime(req.created_at),
      date: this.formatDate(req.created_at)
    };
  }

  mapStatus(status: string): RequestItem['status'] {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'n' || normalized === 'new') return 'new';
    if (normalized === 'i' || normalized === 'inprogress' || normalized === 'in-progress') return 'inprogress';
    if (normalized === 'c' || normalized === 'completed') return 'completed';
    if (normalized === 'r' || normalized === 'rejected') return 'rejected';
    return 'new';
  }

  formatStatusLabel(status: RequestItem['status']): string {
    switch (status) {
      case 'new': return 'Pending';
      case 'inprogress': return 'In Progress';
      case 'completed': return 'Completed';
      case 'rejected': return 'Rejected';
      default: return 'Pending';
    }
  }

  getStatusBadgeClass(status: RequestItem['status']): string {
    switch (status) {
      case 'new': return 'badge-pending';
      case 'inprogress': return 'badge-progress';
      case 'completed': return 'badge-completed';
      case 'rejected': return 'badge-rejected';
      default: return 'badge-pending';
    }
  }

  formatTime(timestamp: string): string {
    const date = new Date(timestamp || Date.now());
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatDate(timestamp: string): string {
    const date = new Date(timestamp || Date.now());
    return date.toLocaleDateString();
  }

  viewAllRequests() {
    this.router.navigate(['/app/user-request']);
  }

  loadMyItems() {
    if (!this.currentUser || !this.currentUser.cubicle_label) {
      this.myItemsCount = 0;
      return;
    }

    this.inventoryService.getItemsByCubicle(this.currentUser.cubicle_label).subscribe(
      (response) => {
        if (response.success && Array.isArray(response.items)) {
          this.myItemsCount = response.items.length;
        } else {
          this.myItemsCount = 0;
        }
      },
      (error) => {
        console.error('Failed to load items for cubicle:', error);
        this.myItemsCount = 0;
      }
    );
  }
}
