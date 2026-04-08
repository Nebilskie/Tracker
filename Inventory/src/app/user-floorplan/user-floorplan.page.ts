import { Component, OnDestroy, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
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
              this.cubicleInventory[row.label] = row;
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
}
