import { Component, OnInit } from '@angular/core';
import { FloorplanApiService, FloorplanLayout } from '../services/floorplan-api';

type Cubicle = {
  id: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  locked?: boolean;
  monitors?: string | null;
  headsets?: string | null;
  cameras?: string | null;
  mouse?: string | null;
  keyboards?: string | null;
  computers?: string | null;
};

@Component({
  selector: 'app-user-floorplan',
  templateUrl: './user-floorplan.page.html',
  styleUrls: ['./user-floorplan.page.scss'],
  standalone: false
})
export class UserFloorplanPage implements OnInit {
  roomId = 'main-office';
  cubicles: Cubicle[] = [];
  cubicleInventory: Record<string, any> = {};

  constructor(private floorplanApi: FloorplanApiService) {}

  ngOnInit() {
    this.loadFloorplanFromIt();
  }

  private async loadFloorplanFromIt() {
    const itUserId = await this.getItUserId();
    if (!itUserId) {
      this.cubicles = [];
      return;
    }

    this.floorplanApi.loadFloorplan(this.roomId).subscribe({
      next: (res: any) => {
        if (res.success && res.floorplan && res.floorplan.layout) {
          const layout = res.floorplan.layout as FloorplanLayout;
          this.cubicles = (layout.cubicles || []) as Cubicle[];
          this.loadFloorplanInventory(this.roomId);
        } else {
          this.cubicles = [];
          this.cubicleInventory = {};
        }
      },
      error: (err) => {
        console.error('❌ Load user floorplan failed:', err);
        this.cubicles = [];
        this.cubicleInventory = {};
      }
    });
  }

  private loadFloorplanInventory(roomId: string) {
    if (!roomId) {
      this.cubicleInventory = {};
      return;
    }

    this.floorplanApi.getFloorplanInventory(roomId).subscribe({
      next: (res: any) => {
        if (res?.success && Array.isArray(res.inventory)) {
          this.cubicleInventory = {};
          res.inventory.forEach((row: any) => {
            const key = this.normalizeCubicleLabel(row?.label);
            if (key) {
              this.cubicleInventory[key] = row;
            }
          });
        } else {
          this.cubicleInventory = {};
        }
      },
      error: (err) => {
        console.error('❌ Load floorplan inventory failed:', err);
        this.cubicleInventory = {};
      }
    });
  }

  private normalizeCubicleLabel(label: string | null | undefined): string {
    return String(label || '').trim().toLowerCase();
  }

  getCubicleInventorySummary(label: string): string {
    const row = this.cubicleInventory[this.normalizeCubicleLabel(label)] || {};
    const parts: string[] = [];

    if (row?.monitors) parts.push(`M:${row.monitors}`);
    if (row?.headsets) parts.push(`H:${row.headsets}`);
    if (row?.cameras) parts.push(`C:${row.cameras}`);
    if (row?.mouse) parts.push(`Mo:${row.mouse}`);
    if (row?.keyboards) parts.push(`K:${row.keyboards}`);
    if (row?.computers) parts.push(`PC:${row.computers}`);

    return parts.join(' | ');
  }

  hasCubicleInventory(label: string): boolean {
    return !!this.cubicleInventory[this.normalizeCubicleLabel(label)];
  }

  private async getCurrentUserId(): Promise<number | null> {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (parsed?.id !== undefined && parsed?.id !== null) {
        return Number(parsed.id);
      }
    } catch {
      // ignore
    }

    return null;
  }

  private async getCurrentUserRole(): Promise<string | null> {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (parsed?.role) {
        return String(parsed.role).toUpperCase();
      }
    } catch {
      // ignore
    }

    return null;
  }

  private async getItUserId(): Promise<number | null> {
    // First check if the app already stored a designated IT user ID.
    const stored = localStorage.getItem('itUserId');
    if (stored) {
      const n = Number(stored);
      if (!Number.isNaN(n)) return n;
    }

    // If the currently logged-in user is IT, use their ID and remember it.
    const role = await this.getCurrentUserRole();
    const currentUserId = await this.getCurrentUserId();
    if (role === 'IT' && currentUserId != null) {
      localStorage.setItem('itUserId', String(currentUserId));
      return currentUserId;
    }

    // Default IT user id when viewing as non-IT user.
    return 1;
  }
}


