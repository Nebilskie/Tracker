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
export class UserFloorplanPage implements OnInit, OnDestroy {
  roomId = '';
  rooms: string[] = [];
  floorItems: FloorItem[] = [];
  loading = true;

  hoveredCubicleLabel: string | null = null;
  cubicleInventory: Record<string, any> = {};

  private readonly KEY_CURRENT_ROOM = 'user_floorplan_current_room';
  private readonly INVENTORY_REFRESH_INTERVAL = 5000;
  private inventoryRefreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private floorplanApi: FloorplanApiService) {}

  async ngOnInit() {
    const { value: savedRoom } = await Preferences.get({ key: this.KEY_CURRENT_ROOM });

    await this.loadRoomsFromDb();

    if (savedRoom && this.rooms.includes(savedRoom)) {
      this.roomId = savedRoom;
    } else if (this.rooms.length > 0) {
      this.roomId = this.rooms[0];
    } else {
      this.roomId = '';
    }

    if (this.roomId) {
      await Preferences.set({ key: this.KEY_CURRENT_ROOM, value: this.roomId });
      await this.loadFloorplanForRoom(this.roomId);
    } else {
      this.floorItems = [];
      this.loading = false;
      await Preferences.remove({ key: this.KEY_CURRENT_ROOM });
    }
  }

  ngOnDestroy() {
    if (this.inventoryRefreshInterval) {
      clearInterval(this.inventoryRefreshInterval);
      this.inventoryRefreshInterval = null;
    }
  }

  async switchRoom(room: string) {
    if (this.roomId === room) return;

    if (this.inventoryRefreshInterval) {
      clearInterval(this.inventoryRefreshInterval);
      this.inventoryRefreshInterval = null;
    }

    this.roomId = room;
    await Preferences.set({ key: this.KEY_CURRENT_ROOM, value: room });
    await this.loadFloorplanForRoom(room);
  }

  onCubicleHover(label: string | null) {
    this.hoveredCubicleLabel = label;
  }

  getInventoryTooltipLines(label: string): string[] {
    const row = this.cubicleInventory[label] || {};

    const fields: Array<[string, any]> = [
      ['Monitor', row.monitors],
      ['Headset', row.headsets],
      ['Camera', row.cameras],
      ['Mouse', row.mouse],
      ['Keyboard', row.keyboards],
      ['Computer', row.computers],
    ];

    const lines = fields
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
      .map(([labelText, value]) => `${labelText}: ${value}`);

    return lines.length > 0 ? lines : ['No assigned items'];
  }

  private async loadRoomsFromDb() {
    try {
      const res: any = await firstValueFrom(this.floorplanApi.listRooms());
      if (res?.success && Array.isArray(res.rooms)) {
        const dbRooms: string[] = res.rooms
          .map((row: any) => row.room_name)
          .filter((roomName: string) => !!roomName);

        this.rooms = [...new Set(dbRooms)].sort((a, b) => a.localeCompare(b));
      } else {
        this.rooms = [];
      }
    } catch (err) {
      console.error('Failed loading floorplan rooms:', err);
      this.rooms = [];
    }
  }

  private async loadFloorplanForRoom(room: string) {
    this.loading = true;
    if (!room) {
      this.floorItems = [];
      this.loading = false;
      return;
    }

    try {
      const res: any = await firstValueFrom(this.floorplanApi.loadFloorplan(room));
      if (res.success && res.floorplan && res.floorplan.layout) {
        const layout = res.floorplan.layout as FloorplanLayout;

        this.floorItems = (layout.cubicles || []).map((c: any) => ({
          id: Number(c.id),
          type: (c.type || c.itemType || 'cubicle') as FloorItemType,
          label: c.label || '',
          x: Number(c.x || 0),
          y: Number(c.y || 0),
          w: Number(c.w || 60),
          h: Number(c.h || 40),
          color: c.color || this.getDefaultColor((c.type || 'cubicle') as FloorItemType),
          locked: !!c.locked,
          createdOrder: Number(c.createdOrder || c.created_order || c.id || 0)
        }));

        this.renumberCubicles();
      } else {
        this.floorItems = [];
      }
    } catch (err) {
      console.error('Load user floorplan failed:', err);
      this.floorItems = [];
    } finally {
      this.loading = false;
    }

    this.loadFloorplanInventory(room);
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
