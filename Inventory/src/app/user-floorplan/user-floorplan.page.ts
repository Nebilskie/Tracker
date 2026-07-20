import { Component, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
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

type MstBuilding = {
  id: number;
  user_id: string;
  building_name: string;
  created_at?: string;
};

type BuildingRoom = {
  id: number;
  room_name: string;
  user_id: string;
  building_id: number;
  cubicles?: number;
  itemsAssigned?: number;
};

type RoomPreview = {
  roomId: number;
  items: FloorItem[];
  minX: number;
  minY: number;
  contentW: number;
  contentH: number;
};

@Component({
  selector: 'app-user-floorplan',
  templateUrl: './user-floorplan.page.html',
  styleUrls: ['./user-floorplan.page.scss'],
  standalone: false
})
export class UserFloorplanPage implements OnInit {
  roomId: number | null = null;
  activeRoomId: number | null = null;
  buildingSearch = '';
  buildings: MstBuilding[] = [];
  activeBuildingId: number | null = null;
  rooms: BuildingRoom[] = [];
  showFloorCanvas = false;
  loading = true;
  floorItems: FloorItem[] = [];
  cubicles: Cubicle[] = [];
  cubicleInventory: Record<string, any> = {};
  roomPreviewCache = new Map<number, RoomPreview>();
  roomPreviewLoadingId: number | null = null;
  hoveredCubicleLabel: string | null = null;
  inventoryRefreshInterval: any = null;
  readonly INVENTORY_REFRESH_INTERVAL = 5000;
  hoveredBuildingId: number | null = null;
  buildingRoomsLoadingId: number | null = null;
  loadingBuildingRoomIds = new Set<number>();
  buildingHoverStyle: Record<string, string> = {};
  buildingRoomsCache = new Map<number, BuildingRoom[]>();
  hoveredRoomId: number | null = null;
  roomHoverStyle: Record<string, string> = {};

  constructor(private floorplanApi: FloorplanApiService) {}

  async ngOnInit() {
    await this.loadBuildings();
  }

  ionViewWillEnter() {
    this.onSeeAllBuildings();
  }

  get activeBuilding(): MstBuilding | null {
    return this.buildings.find((b) => b.id === this.activeBuildingId) ?? null;
  }

  get activeRoom(): BuildingRoom | null {
    return this.rooms.find((r) => r.id === this.roomId) ?? null;
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

    if (this.roomId == null) {
      this.cubicles = [];
      this.floorItems = [];
      this.cubicleInventory = {};
      this.loading = false;
      return;
    }

    this.floorplanApi.loadFloorplan(String(this.roomId)).subscribe({
      next: (res: any) => {
        if (res.success && res.floorplan && res.floorplan.layout) {
          const items = (res.floorplan.layout.cubicles || []) as Cubicle[];
          this.cubicles = items;
          this.floorItems = items.map((item) => ({
            ...item,
            color: item.color || this.getDefaultColor(item.type),
          }));
            if (this.roomId != null) this.loadFloorplanInventory(this.roomId);
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

  private loadFloorplanInventory(roomId: number) {
    if (roomId == null) {
      this.cubicleInventory = {};
      return;
    }

    if (this.inventoryRefreshInterval) {
      clearInterval(this.inventoryRefreshInterval);
      this.inventoryRefreshInterval = null;
    }

    this.refreshInventoryFromServer(String(roomId));

    this.inventoryRefreshInterval = setInterval(() => {
      this.refreshInventoryFromServer(String(roomId));
    }, this.INVENTORY_REFRESH_INTERVAL);
  }
  async selectBuilding(building: MstBuilding) {
    if (!building?.id) return;
    this.activeBuildingId = building.id;
    this.rooms = [];
    this.floorItems = [];
    this.cubicleInventory = {};
    this.loading = true;
    await this.loadRoomsForBuilding(building.id);
  }

  get filteredBuildings(): MstBuilding[] {
    const filterTerm = String(this.buildingSearch || '').toLowerCase().trim();
    if (!filterTerm) return this.buildings;
    return this.buildings.filter((b) =>
      String(b.building_name || '').toLowerCase().includes(filterTerm)
    );
  }

  private async ensureRoomPreview(roomId: number) {
    if (!roomId) return;
    if (this.roomPreviewCache.has(roomId)) return;
    if (this.roomPreviewLoadingId === roomId) return;

    this.roomPreviewLoadingId = roomId;
    try {
      const res: any = await firstValueFrom(this.floorplanApi.loadFloorplan(String(roomId)));
      const layout = res?.success && res?.floorplan?.layout ? (res.floorplan.layout as FloorplanLayout) : null;
      const cubs = Array.isArray(layout?.cubicles) ? layout!.cubicles : [];

      const items: FloorItem[] = cubs.map((c: any) => ({
        id: Number(c.id ?? Date.now()),
        type: (c.type || c.itemType || 'cubicle') as FloorItemType,
        label: String(c.label || ''),
        x: Number(c.x || 0),
        y: Number(c.y || 0),
        w: Number(c.w || 60),
        h: Number(c.h || 40),
        color: String(c.color || this.getDefaultColor((c.type || 'cubicle') as FloorItemType)),
        locked: !!c.locked,
        createdOrder: Number(c.createdOrder || c.created_order || c.id || 0),
      }));

      let minX = 0;
      let minY = 0;
      let maxX = 1;
      let maxY = 1;
      if (items.length) {
        minX = Math.min(...items.map((i) => i.x));
        minY = Math.min(...items.map((i) => i.y));
        maxX = Math.max(...items.map((i) => i.x + i.w));
        maxY = Math.max(...items.map((i) => i.y + i.h));
      }

      const contentW = Math.max(1, maxX - minX);
      const contentH = Math.max(1, maxY - minY);

      this.roomPreviewCache.set(roomId, {
        roomId,
        items,
        minX,
        minY,
        contentW,
        contentH,
      });
    } catch (e) {
      console.warn('Room preview load failed', roomId, e);
      this.roomPreviewCache.set(roomId, {
        roomId,
        items: [],
        minX: 0,
        minY: 0,
        contentW: 1,
        contentH: 1,
      });
    } finally {
      if (this.roomPreviewLoadingId === roomId) {
        this.roomPreviewLoadingId = null;
      }
    }
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
    const lines: string[] = [];

    const assignedUsers = String(row.assignedUsers || '').trim();
    if (assignedUsers) {
      lines.push(`User: ${assignedUsers}`);
    }

    if (Array.isArray(row.itemNames) && row.itemNames.length > 0) {
      lines.push(`Items: ${row.itemNames.join(', ')}`);
    }

    const monitor = row.monitors ? Number(row.monitors) : 0;
    const headset = row.headsets ? Number(row.headsets) : 0;
    const camera = row.cameras ? Number(row.cameras) : 0;
    const mouse = row.mouse ? Number(row.mouse) : 0;
    const keyboard = row.keyboards ? Number(row.keyboards) : 0;
    const computer = row.computers ? Number(row.computers) : 0;
    const equipment: string[] = [];

    if (monitor) equipment.push(`M:${monitor}`);
    if (headset) equipment.push(`H:${headset}`);
    if (mouse) equipment.push(`Mo:${mouse}`);
    if (keyboard) equipment.push(`K:${keyboard}`);
    if (computer) equipment.push(`PC:${computer}`);

    if (equipment.length > 0) {
      lines.push(`Inventory: ${equipment.join(' | ')}`);
    }

    if (!lines.length) {
      lines.push('No assignment or items found');
    }

    return lines;
  }

  switchRoom(roomId: number) {
    if (this.roomId === roomId) return;
    this.roomId = roomId;
    this.activeRoomId = roomId;
    this.showFloorCanvas = true;
    this.loadFloorplanFromIt();
  }

  closeFloorLayout() {
    this.showFloorCanvas = false;
    this.activeRoomId = null;
  }

  onSeeAllBuildings() {
    this.activeBuildingId = null;
    this.rooms = [];
    this.roomId = null;
    this.activeRoomId = null;
    this.showFloorCanvas = false;
    this.floorItems = [];
    this.cubicleInventory = {};
  }

  onCanvasClick(_event: Event) {
    this.onSeeAllBuildings();
  }

  

  getBuildingRooms(buildingId: number): BuildingRoom[] {
    return this.buildingRoomsCache.get(buildingId) ?? [];
  }

  hasBuildingRoomsLoaded(buildingId: number): boolean {
    return this.buildingRoomsCache.has(buildingId);
  }

  isBuildingRoomsLoading(buildingId: number): boolean {
    return this.loadingBuildingRoomIds.has(buildingId);
  }

  onBuildingMouseEnter(b: MstBuilding, ev?: MouseEvent) {
    this.hoveredBuildingId = b.id;
    void this.ensureBuildingRooms(b.id);
    this.buildingHoverStyle = this.computeHoverStyle(
      (ev?.currentTarget as HTMLElement) ?? null,
      this.getBuildingHoverSize(this.getBuildingRooms(b.id).length)
    );
  }

  onBuildingMouseLeave() {
    this.hoveredBuildingId = null;
    this.buildingRoomsLoadingId = null;
    this.buildingHoverStyle = {};
  }

  onRoomMouseEnter(r: BuildingRoom, ev?: MouseEvent) {
    this.hoveredRoomId = r.id;
    this.roomHoverStyle = this.computeHoverStyle((ev?.currentTarget as HTMLElement) ?? null, { w: 760, h: 460 });
  }

  onRoomMouseLeave() {
    this.hoveredRoomId = null;
    this.roomHoverStyle = {};
  }

  openFloorLayoutFromRoom(room: BuildingRoom) {
    if (!room?.id) return;
    this.roomId = room.id;
    this.activeRoomId = room.id;
    this.showFloorCanvas = true;
    this.loadFloorplanFromIt();
  }

  getRoomPreviewTransformForPadded(
    roomId: number,
    viewportW: number,
    viewportH: number,
    pad: number,
    scaleModifier = 1,
    verticalBias = 0
  ): string {
    const innerW = Math.max(1, viewportW - pad * 2);
    const innerH = Math.max(1, viewportH - pad * 2);
    const t = this.getRoomPreviewTransformFor(roomId, innerW, innerH, scaleModifier);
    return `translate(${pad}px, ${pad + verticalBias}px) ${t}`;
  }

  private computeHoverStyle(
    anchorEl: HTMLElement | null,
    approxSize: { w: number; h: number }
  ): Record<string, any> {
    const margin = 12;
    const vw = Math.max(320, window.innerWidth || 0);
    const vh = Math.max(320, window.innerHeight || 0);

    const rect = anchorEl?.getBoundingClientRect?.();
    const anchorLeft = rect?.left ?? margin;
    const anchorTop = rect?.top ?? margin;
    const anchorRight = rect?.right ?? margin + 200;

    // If there is a persistent left sidebar/menu, prevent the hover from being placed under it.
    const sidebarEl =
      (document.querySelector('ion-menu') as HTMLElement | null) ??
      (document.querySelector('.menu') as HTMLElement | null) ??
      (document.querySelector('.side-menu') as HTMLElement | null) ??
      (document.querySelector('ion-split-pane') as HTMLElement | null);
    const sidebarRect = sidebarEl?.getBoundingClientRect?.();
    // Fallback to known layout (bottom bar uses left: 228px)
    const sidebarRight =
      sidebarRect && sidebarRect.width > 40 ? sidebarRect.right : 228;

    // mimic existing positioning: show to the right, slightly overlapping the card
    let left = anchorRight - 80;
    let top = Math.max(margin, anchorTop - 16);

    const panelW = Math.min(approxSize.w, vw - margin * 2);
    const panelH = Math.min(approxSize.h, vh - margin * 2);

    // If it would overflow right edge, flip to the left side.
    if (left + panelW > vw - margin) {
      left = anchorLeft - panelW + 80;
    }

    // Clamp into viewport.
    left = Math.max(sidebarRight + margin, Math.min(left, vw - panelW - margin));
    top = Math.max(margin, Math.min(top, vh - panelH - margin));

    return {
      position: 'fixed',
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${panelW}px`,
      height: `${panelH}px`,
      maxWidth: `calc(100vw - ${margin * 2}px)`,
      maxHeight: `calc(100vh - ${margin * 2}px)`,
      zIndex: 1000000,
    };
  }

  private getBuildingHoverSize(roomCount: number): { w: number; h: number } {
    if (roomCount <= 0) return { w: 420, h: 120 };
    if (roomCount === 1) return { w: 520, h: 300 };
    if (roomCount === 2) return { w: 880, h: 300 };
    if (roomCount === 3) return { w: 980, h: 340 };
    return { w: 980, h: 380 };
  }

  private async ensureBuildingRooms(buildingId: number) {
    if (!buildingId) return;
    if (this.buildingRoomsCache.has(buildingId)) return;
    if (this.loadingBuildingRoomIds.has(buildingId)) return;

    this.buildingRoomsLoadingId = buildingId;
    this.loadingBuildingRoomIds.add(buildingId);
    try {
      const res: any = await firstValueFrom(
        this.floorplanApi.listBuildingRooms(buildingId)
      );
      if (res?.success && Array.isArray(res.rooms)) {
        const rooms: BuildingRoom[] = res.rooms.map((r: any) => ({
          id: Number(r.id),
          room_name: r.room_name,
          user_id: r.user_id,
          building_id: Number(r.building_id),
          cubicles: Number(r.cubicles || 0),
          itemsAssigned: Number(r.itemsAssigned || 0)
        }));
        this.buildingRoomsCache.set(buildingId, rooms);
        for (const room of rooms.slice(0, 6)) {
          void this.ensureRoomPreview(room.id);
        }
      }
    } catch (e) {
      console.warn('Building rooms load failed', buildingId, e);
      this.buildingRoomsCache.set(buildingId, []);
    } finally {
      this.loadingBuildingRoomIds.delete(buildingId);
      if (this.buildingRoomsLoadingId === buildingId) {
        this.buildingRoomsLoadingId = null;
      }
    }
  }

  get activeBuildingName(): string | null {
    return this.activeBuilding?.building_name ?? null;
  }

  getRoomPreview(roomId: number): RoomPreview | null {
    return this.roomPreviewCache.get(roomId) ?? null;
  }

  getRoomPreviewTransformFor(roomId: number, viewportW: number, viewportH: number, scaleModifier = 1): string {
    const p = this.getRoomPreview(roomId);
    if (!p) return '';
    const scale = Math.min(viewportW / p.contentW, viewportH / p.contentH, 1) * scaleModifier;
    const offsetX = (viewportW - p.contentW * scale) / 2 - p.minX * scale;
    const offsetY = (viewportH - p.contentH * scale) / 2 - p.minY * scale;
    return `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  private async loadBuildings() {
    this.loading = true;
    try {
      const userId = await this.getCurrentUserId();
      this.floorplanApi.listBuildings(userId ?? undefined).subscribe({
        next: (res: any) => {
          if (res?.success && Array.isArray(res.buildings)) {
            this.buildings = res.buildings;
            for (const building of this.buildings) {
              void this.ensureBuildingRooms(building.id);
            }
            this.activeBuildingId = null;
            this.rooms = [];
            this.roomId = null;
            this.activeRoomId = null;
            this.showFloorCanvas = false;
            this.floorItems = [];
            this.cubicleInventory = {};
            if (this.buildings.length === 0) {
              this.buildings = [];
              this.rooms = [];
              this.floorItems = [];
              this.cubicleInventory = {};
            }
          } else {
            this.buildings = [];
            this.rooms = [];
            this.floorItems = [];
            this.cubicleInventory = {};
          }
          this.loading = false;
        },
        error: (err) => {
          console.error('❌ Load buildings failed:', err);
          this.buildings = [];
          this.rooms = [];
          this.floorItems = [];
          this.cubicleInventory = {};
          this.loading = false;
        }
      });
    } catch (err) {
      console.error('❌ Load buildings failed:', err);
      this.buildings = [];
      this.rooms = [];
      this.floorItems = [];
      this.cubicleInventory = {};
      this.loading = false;
    }
  }

  private async loadRoomsForBuilding(buildingId: number) {
    this.loading = true;
    this.rooms = [];
    try {
      this.floorplanApi.listBuildingRooms(buildingId).subscribe({
        next: (res: any) => {
          if (res?.success && Array.isArray(res.rooms)) {
            this.rooms = res.rooms.map((r: any) => ({
              id: Number(r.id),
              room_name: r.room_name,
              user_id: r.user_id,
              building_id: Number(r.building_id),
              cubicles: Number(r.cubicles || 0),
              itemsAssigned: Number(r.itemsAssigned || 0)
            }));
            if (this.rooms.length > 0) {
              this.roomId = this.rooms[0].id;
              this.activeRoomId = this.rooms[0].id;
              this.loadFloorplanFromIt();
              for (const room of this.rooms.slice(0, 12)) {
                void this.ensureRoomPreview(room.id);
              }
            } else {
                this.roomId = null;
                this.activeRoomId = null;
              this.floorItems = [];
              this.cubicleInventory = {};
            }
          } else {
            this.rooms = [];
              this.roomId = null;
              this.activeRoomId = null;
            this.floorItems = [];
            this.cubicleInventory = {};
          }
          this.loading = false;
        },
        error: (err) => {
          console.error('❌ Load rooms failed:', err);
          this.rooms = [];
            this.roomId = null;
            this.activeRoomId = null;
          this.floorItems = [];
          this.cubicleInventory = {};
          this.loading = false;
        }
      });
    } catch (err) {
      console.error('❌ Load rooms failed:', err);
      this.rooms = [];
        this.roomId = null;
      this.floorItems = [];
      this.cubicleInventory = {};
      this.loading = false;
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
