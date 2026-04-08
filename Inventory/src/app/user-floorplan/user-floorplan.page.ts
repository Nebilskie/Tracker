import { Component, OnInit } from '@angular/core';
import { FloorplanApiService, FloorplanLayout } from '../services/floorplan-api';

type FloorItemType = 'cubicle' | 'wall' | 'door' | 'table';

type FloorItem = {
  id: number;
  type: FloorItemType;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  locked: boolean;
  createdOrder: number;
};

type Cubicle = FloorItem & {
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
  rooms: string[] = [];
  loading = true;
  floorItems: FloorItem[] = [];
  cubicles: Cubicle[] = [];
  cubicleInventory: Record<string, any> = {};
  hoveredCubicleLabel: string | null = null;
  inventoryRefreshInterval: any = null;
  readonly INVENTORY_REFRESH_INTERVAL = 5000;

  constructor(private floorplanApi: FloorplanApiService) {}

  async ngOnInit() {
    this.loadRooms();
  }

  private async loadFloorplanFromIt() {
    this.loading = true;
    const itUserId = await this.getItUserId();
    if (!itUserId) {
      this.cubicles = [];
      this.floorItems = [];
      this.cubicleInventory = {};
      this.loading = false;
      return;
    }

    this.floorplanApi.loadFloorplan(this.roomId).subscribe({
      next: (res: any) => {
        if (res.success && res.floorplan && res.floorplan.layout) {
          const items = (res.floorplan.layout.cubicles || []) as Cubicle[];
          this.cubicles = items;
          this.floorItems = items.map((item) => ({
            ...item,
            color: item.color || this.getDefaultColor(item.type),
          }));
          this.loadFloorplanInventory(this.roomId);
        } else {
          this.cubicles = [];
          this.floorItems = [];
          this.cubicleInventory = {};
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('❌ Load user floorplan failed:', err);
        this.cubicles = [];
        this.floorItems = [];
        this.cubicleInventory = {};
        this.loading = false;
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

  private loadFloorplanInventory(room: string) {
    if (!room) {
      this.cubicleInventory = {};
      return;
    }

    if (this.inventoryRefreshInterval) {
      clearInterval(this.inventoryRefreshInterval);
      this.inventoryRefreshInterval = null;
    }

    this.refreshInventoryFromServer(room);

    this.inventoryRefreshInterval = setInterval(() => {
      this.refreshInventoryFromServer(room);
    }, this.INVENTORY_REFRESH_INTERVAL);
  }

  private refreshInventoryFromServer(room: string) {
    this.floorplanApi.getFloorplanInventory(room).subscribe({
      next: (res: any) => {
        if (res?.success && Array.isArray(res.inventory)) {
          this.cubicleInventory = {};
          res.inventory.forEach((row: any) => {
            if (row?.label) {
              this.cubicleInventory[this.normalizeCubicleLabel(row.label)] = row;
            }
          });
        } else {
          this.cubicleInventory = {};
        }
      },
      error: (err: any) => {
        console.error('Load cubicle inventory failed:', err);
        this.cubicleInventory = {};
      },
    });
  }

  private getDefaultColor(type: FloorItemType): string {
    switch (type) {
      case 'wall':
        return '#5f6368';
      case 'door':
        return '#c49a6c';
      case 'table':
        return '#8d6e63';
      case 'cubicle':
      default:
        return '#4caf50';
    }
  }

  onCubicleHover(label: string | null) {
    this.hoveredCubicleLabel = label;
  }

  getInventoryTooltipLines(label: string): string[] {
    const row = this.cubicleInventory[this.normalizeCubicleLabel(label)] || {};

    const monitor = row.monitors ? String(row.monitors) : '-';
    const headset = row.headsets ? String(row.headsets) : '-';
    const camera = row.cameras ? String(row.cameras) : '-';
    const mouse = row.mouse ? String(row.mouse) : '-';
    const keyboard = row.keyboards ? String(row.keyboards) : '-';
    const computer = row.computers ? String(row.computers) : '-';

    return [
      `Monitor: ${monitor}`,
      `Headset: ${headset}`,
      `Camera: ${camera}`,
      `Mouse: ${mouse}`,
      `Keyboard: ${keyboard}`,
      `Computer: ${computer}`,
    ];
  }

  switchRoom(room: string) {
    if (this.roomId === room) return;
    this.roomId = room;
    this.loadFloorplanFromIt();
  }

  private async loadRooms() {
    this.roomId = this.roomId || 'main-office';
    this.floorplanApi.listRooms().subscribe({
      next: (res: any) => {
        if (res?.success && Array.isArray(res.rooms)) {
          this.rooms = res.rooms
            .map((row: any) => String(row.room_name || '').trim())
            .filter((name: string) => !!name);
          if (this.rooms.length && !this.rooms.includes(this.roomId)) {
            this.roomId = this.rooms[0];
          }
        } else {
          this.rooms = [];
        }
        this.loadFloorplanFromIt();
      },
      error: (err) => {
        console.error('❌ Load rooms failed:', err);
        this.rooms = [];
        this.loadFloorplanFromIt();
      }
    });
  }

  private renumberCubicles() {
    const sorted = [...this.floorItems].sort((a, b) => {
      const aOrder = Number(a.createdOrder || 0);
      const bOrder = Number(b.createdOrder || 0);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return Number(a.id) - Number(b.id);
    });

    let cubicleNumber = 1;
    sorted.forEach((item) => {
      if (item.type === 'cubicle') {
        item.label = `C${cubicleNumber++}`;
      } else {
        item.label = '';
      }
    });

    this.floorItems = sorted;
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
    const stored = localStorage.getItem('itUserId');
    if (stored) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed)) return parsed;
    }

    const role = await this.getCurrentUserRole();
    const currentUserId = await this.getCurrentUserId();
    if (role === 'IT' && currentUserId != null) {
      localStorage.setItem('itUserId', String(currentUserId));
      return currentUserId;
    }

    return 1;
  }
}
