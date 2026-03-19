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
        } else {
          this.cubicles = [];
        }
      },
      error: (err) => {
        console.error('❌ Load user floorplan failed:', err);
        this.cubicles = [];
      }
    });
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


