import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  ChangeDetectorRef
} from '@angular/core';
import { AlertController } from '@ionic/angular';
import { NotificationService } from '../services/notification.service';
import { firstValueFrom } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { FloorplanApiService, FloorplanLayout } from '../services/floorplan-api';

type FloorItemType = 'cubicle' | 'wall' | 'door' | 'table';
type ResizeDirection =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

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

type RectBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type MstBuilding = {
  id: number;
  user_id: string;
  building_name: string;
  created_at?: string;
};

export type BuildingRoom = {
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
  selector: 'app-it-floorplan',
  templateUrl: './it-floorplan.page.html',
  styleUrls: ['./it-floorplan.page.scss'],
  standalone: false
})
export class ItFloorplanPage implements OnInit, OnDestroy {
  @ViewChild('containerRef', { static: false }) containerRef!: ElementRef<HTMLElement>;

  roomId = '';
  userId: number | null = null;

  buildings: MstBuilding[] = [];
  activeBuildingId: number | null = null;
  buildingSearch = '';
  showFloorCanvas = false;

  rooms: BuildingRoom[] = [];
  activeRoomId: number | null = null;
  hoveredRoomId: number | null = null;
  hoveredBuildingId: number | null = null;
  buildingHoverStyle: Record<string, any> = {};
  roomHoverStyle: Record<string, any> = {};
  private hoverLeaveTimer: number | null = null;

  private buildingRoomsCache = new Map<number, BuildingRoom[]>();
  buildingRoomsLoadingId: number | null = null;

  private roomPreviewCache = new Map<number, RoomPreview>();
  roomPreviewLoadingId: number | null = null;

  selectedColor = '#4caf50';
  selectedItemType: FloorItemType = 'cubicle';

  toolboxOpen = false;
  isEditMode = false;
  paintMode = false;
  addMode = false;

  selectedItemId: number | null = null;
  hoveredCubicleLabel: string | null = null;
  cubicleInventory: Record<string, any> = {};

  get selectedFloorItem(): FloorItem | null {
    return this.floorItems.find((item) => item.id === this.selectedItemId) ?? null;
  }

  // Transfer UI state
  transferPanelOpen = false;
  transferFromLabel: string | null = null;
  transferFromCubicleId: number | null = null;
  transferToCubicleId: number | null = null;
  transferTargetBuildingId: number | null = null;
  transferTargetRoomId: number | null = null;
  availableCubicles: Array<{ id: number; label: string; assignedUser?: string | null }> = [];
  transferTargetRooms: BuildingRoom[] = [];
  transferTargetCubicles: Array<{ id: number; label: string; assignedUser?: string | null }> = [];
  transferSelectedTypes: string[] = [];
  transferMode: 'all' | 'selected' | 'userOnly' = 'all';
  transferAssignedUser = false;
  transferSourceItems: Array<{ label: string; type: string; code: string; selected: boolean }> = [];
  readonly availableItemTypes = [
    { key: 'monitor', label: 'Monitor' },
    { key: 'headset', label: 'Headset' },
    { key: 'camera', label: 'Camera' },
    { key: 'mouse', label: 'Mouse' },
    { key: 'keyboard', label: 'Keyboard' },
    { key: 'computer', label: 'Computer' },
  ];

  toolboxX = 30;
  toolboxY = 250;

  floorItems: FloorItem[] = [];
  cubicleCount = 1;

  private hasUnsavedEdits = false;
  private editSnapshot:
    | {
        floorItems: FloorItem[];
        cubicleCount: number;
      }
    | null = null;

  private readonly gridSize = 20;
  private readonly minItemSize = 20;

  private readonly KEY_TOOLBOX_POS = 'floorplan_toolbox_pos';
  private readonly KEY_CURRENT_ROOM = 'floorplan_current_room';
  private readonly KEY_CURRENT_BUILDING = 'floorplan_current_building_id';
  private readonly KEY_CURRENT_ROOM_ID = 'floorplan_current_room_id';
  private readonly KEY_LAST_VIEW = 'floorplan_last_view';

  private readonly VIEW_BUILDINGS = 'buildings';
  private readonly VIEW_ROOMS = 'rooms';
  private readonly VIEW_CANVAS = 'canvas';

  private toolboxDragging = false;
  private toolboxDragOffsetX = 0;
  private toolboxDragOffsetY = 0;
  private toolboxMove = (e: PointerEvent) => this.onToolboxDragMove(e);
  private toolboxUp = () => this.onToolboxDragEnd();

  private readonly panelW = 210;
  private readonly panelH = 360;

  private itemDragging = false;
  private dragItemId: number | null = null;
  private itemDragOffsetX = 0;
  private itemDragOffsetY = 0;
  private lastDragPointerX = 0;
  private lastDragPointerY = 0;

  private itemMove = (e: PointerEvent) => this.onItemDragMove(e);
  private itemUp = () => this.onItemDragEnd();

  private resizing = false;
  private resizeItemId: number | null = null;
  private resizeDirection: ResizeDirection | null = null;
  private resizeStart:
    | {
        w: number;
        h: number;
        x: number;
        y: number;
        pointerX: number;
        pointerY: number;
      }
    | null = null;

  private resizeMove = (e: PointerEvent) => this.onResizeMove(e);
  private resizeUp = () => this.onResizeEnd();

  private inventoryRefreshInterval: any = null;
  private readonly INVENTORY_REFRESH_INTERVAL = 5000; // 5 seconds

  handleKeyDelete = async (e: KeyboardEvent) => {
    if (!this.isEditMode) return;
    if (!this.selectedItemId) return;

    const tagName = (document.activeElement?.tagName || '').toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      await this.deleteItem(this.selectedItemId);
    }
  };

  constructor(
    private floorplanApi: FloorplanApiService,
    private cdr: ChangeDetectorRef,
    private alertController: AlertController,
    private notification: NotificationService
  ) {}

  async ngOnInit() {
    await this.loadToolboxPos();
    this.userId = await this.getCurrentUserId();
    await this.loadBuildingsFromApi();
    await this.warmBuildingPreviews();

    // Always start from the buildings overview when opening the floorplan page.
    this.onSeeAllBuildings();

    // Restore last view (buildings/rooms/canvas) when returning to this page.
    const [{ value: savedView }, { value: savedBid }, { value: savedRid }] =
      await Promise.all([
        Preferences.get({ key: this.KEY_LAST_VIEW }),
        Preferences.get({ key: this.KEY_CURRENT_BUILDING }),
        Preferences.get({ key: this.KEY_CURRENT_ROOM_ID }),
      ]);

    const view =
      savedView === this.VIEW_CANVAS || savedView === this.VIEW_ROOMS || savedView === this.VIEW_BUILDINGS
        ? savedView
        : this.VIEW_BUILDINGS;

    const buildingId =
      savedBid && /^\d+$/.test(savedBid.trim()) ? Number(savedBid.trim()) : null;
    const roomId =
      savedRid && /^\d+$/.test(savedRid.trim()) ? Number(savedRid.trim()) : null;

    const hasBuilding = buildingId != null && this.buildings.some((b) => b.id === buildingId);

    this.hoveredBuildingId = null;
    this.hoveredRoomId = null;

    if (view === this.VIEW_CANVAS && hasBuilding && roomId != null) {
      this.activeBuildingId = buildingId;
      this.activeRoomId = roomId;
      this.showFloorCanvas = true;
      this.rooms = [];
      await this.loadRoomsForBuilding(buildingId as number);
      this.cdr.detectChanges();
      await this.switchRoom(String(roomId), true);
    } else if (view === this.VIEW_ROOMS && hasBuilding) {
      this.activeBuildingId = buildingId;
      this.activeRoomId = roomId != null ? roomId : null;
      this.showFloorCanvas = false;
      this.rooms = [];
      await this.loadRoomsForBuilding(buildingId as number);
    } else {
      // Buildings overview
      this.activeBuildingId = null;
      this.activeRoomId = null;
      this.rooms = [];
      this.showFloorCanvas = false;
      await Preferences.set({ key: this.KEY_LAST_VIEW, value: this.VIEW_BUILDINGS });
    }

    window.addEventListener('keydown', this.handleKeyDelete);
  }

  ionViewWillEnter() {
    this.onSeeAllBuildings();
  }

  get activeBuilding(): MstBuilding | null {
    return (
      this.buildings.find((b) => b.id === this.activeBuildingId) ?? null
    );
  }

  get filteredBuildings(): MstBuilding[] {
    const t = String(this.buildingSearch || '')
      .toLowerCase()
      .trim();
    if (!t) return this.buildings;
    return this.buildings.filter((b) =>
      String(b.building_name || '')
        .toLowerCase()
        .includes(t)
    );
  }

  get canDeleteActiveBuilding(): boolean {
    return (
      this.activeBuilding != null &&
      String(this.activeBuilding.building_name || '')
        .trim()
        .toLowerCase() !== 'storage'
    );
  }

  onBuildingMouseEnter(b: MstBuilding, ev?: MouseEvent) {
    this.cancelScheduledHoverClose();
    this.hoveredRoomId = null;
    this.hoveredBuildingId = b.id;
    void this.ensureBuildingRooms(b.id);
    this.buildingHoverStyle = this.computeHoverStyle(
      (ev?.currentTarget as HTMLElement) ?? null,
      this.getBuildingHoverSize(this.getBuildingRooms(b.id).length)
    );
  }

  onBuildingMouseLeave() {
    this.scheduleHoverClose();
  }

  onBuildingHoverEnter() {
    this.cancelScheduledHoverClose();
  }

  onBuildingHoverLeave() {
    this.scheduleHoverClose();
  }

  get hoveredBuilding(): MstBuilding | null {
    return this.buildings.find((b) => b.id === this.hoveredBuildingId) ?? null;
  }

  get hoveredRoom(): BuildingRoom | null {
    return this.rooms.find((r) => r.id === this.hoveredRoomId) ?? null;
  }

  getBuildingRooms(buildingId: number): BuildingRoom[] {
    return this.buildingRoomsCache.get(buildingId) ?? [];
  }

  private async ensureBuildingRooms(buildingId: number) {
    if (!buildingId) return;
    if (this.buildingRoomsCache.has(buildingId)) return;
    if (this.buildingRoomsLoadingId === buildingId) return;

    this.buildingRoomsLoadingId = buildingId;
    try {
      const res: any = await firstValueFrom(
        this.floorplanApi.listBuildingRooms(buildingId)
      );
      const rooms: BuildingRoom[] =
        res?.success && Array.isArray(res.rooms)
          ? res.rooms.map((r: any) => ({
              id: Number(r.id),
              room_name: r.room_name,
              user_id: r.user_id,
              building_id: Number(r.building_id),
              cubicles: Number(r.cubicles || 0),
              itemsAssigned: Number(r.itemsAssigned || 0),
            }))
          : [];

      this.buildingRoomsCache.set(buildingId, rooms);
      for (const r of rooms.slice(0, 6)) {
        void this.ensureRoomPreview(r.id);
      }
      if (this.hoveredBuildingId === buildingId) {
        const cardEl = document.querySelector(
          `.building-card[data-building-id="${buildingId}"]`
        ) as HTMLElement | null;
        this.buildingHoverStyle = this.computeHoverStyle(
          cardEl,
          this.getBuildingHoverSize(rooms.length)
        );
      }
    } catch (e) {
      console.warn('Building rooms hover load failed', buildingId, e);
      this.buildingRoomsCache.set(buildingId, []);
    } finally {
      if (this.buildingRoomsLoadingId === buildingId) {
        this.buildingRoomsLoadingId = null;
      }
    }
  }

  private slugFromBuildingName(name: string): string {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
  }

  private async loadBuildingsFromApi() {
    try {
      const res: any = await firstValueFrom(
        this.floorplanApi.listBuildings(this.userId ?? undefined)
      );
      if (res?.success && Array.isArray(res.buildings)) {
        this.buildings = res.buildings;
      } else {
        this.buildings = [];
      }
    } catch (err) {
      console.error('Failed loading buildings', err);
      this.buildings = [];
    }
  }

  // Preload room lists (and a few thumbnails) so building cards show real previews.
  private async warmBuildingPreviews() {
    for (const b of this.buildings) {
      // fire-and-forget; cache prevents repeats
      void this.ensureBuildingRooms(b.id);
    }
  }

  selectBuilding(b: MstBuilding) {
    // Ensure any hover panels are closed when navigating.
    this.hoveredBuildingId = null;
    this.hoveredRoomId = null;
    this.activeBuildingId = b.id;
    void Preferences.set({
      key: this.KEY_CURRENT_BUILDING,
      value: String(b.id),
    });
    void Preferences.set({ key: this.KEY_LAST_VIEW, value: this.VIEW_ROOMS });
    this.showFloorCanvas = false;
    this.closeToolbox();
    this.buildingRoomsCache.delete(b.id);
    void this.loadRoomsForBuilding(b.id);
  }

  onSeeAllBuildings() {
    this.buildingSearch = '';
    this.activeBuildingId = null;
    this.hoveredBuildingId = null;
    this.hoveredRoomId = null;
    this.rooms = [];
    this.activeRoomId = null;
    this.showFloorCanvas = false;
    void Preferences.set({ key: this.KEY_LAST_VIEW, value: this.VIEW_BUILDINGS });
    this.closeToolbox();
    if (this.inventoryRefreshInterval) {
      clearInterval(this.inventoryRefreshInterval);
      this.inventoryRefreshInterval = null;
    }
  }

  async openFloorLayoutFromRoom(room: BuildingRoom) {
    if (!room?.id) return;
    // Ensure any hover panels are closed when navigating.
    this.hoveredRoomId = null;
    this.hoveredBuildingId = null;
    this.activeRoomId = room.id;
    await Preferences.set({ key: this.KEY_CURRENT_ROOM_ID, value: String(room.id) });
    await Preferences.set({ key: this.KEY_LAST_VIEW, value: this.VIEW_CANVAS });
    this.showFloorCanvas = true;
    this.cdr.detectChanges();
    await this.switchRoom(String(room.id), true);
  }

  closeFloorLayout() {
    if (this.inventoryRefreshInterval) {
      clearInterval(this.inventoryRefreshInterval);
      this.inventoryRefreshInterval = null;
    }
    this.showFloorCanvas = false;
    this.hoveredRoomId = null;
    this.hoveredBuildingId = null;
    this.closeToolbox();
    void Preferences.set({ key: this.KEY_LAST_VIEW, value: this.VIEW_ROOMS });

    // If we just edited a room, refresh its quickview + stats when returning.
    const rid = this.currentNumericRoomId();
    if (rid != null) {
      this.roomPreviewCache.delete(rid);
    }
    if (this.activeBuildingId != null) {
      void this.loadRoomsForBuilding(this.activeBuildingId);
    }
  }

  get activeRoom(): BuildingRoom | null {
    return this.rooms.find((r) => r.id === this.activeRoomId) ?? null;
  }

  async loadRoomsForBuilding(buildingId: number) {
    this.rooms = [];
    // Keep existing selection if possible; don't auto-select first room.
    const prevSelected = this.activeRoomId;
    try {
      const res: any = await firstValueFrom(this.floorplanApi.listBuildingRooms(buildingId));
      if (res?.success && Array.isArray(res.rooms)) {
        this.rooms = res.rooms.map((r: any) => ({
          id: Number(r.id),
          room_name: r.room_name,
          user_id: r.user_id,
          building_id: Number(r.building_id),
          cubicles: Number(r.cubicles || 0),
          itemsAssigned: Number(r.itemsAssigned || 0),
        }));
      } else {
        this.rooms = [];
      }
      this.buildingRoomsCache.set(buildingId, this.rooms);
      this.activeRoomId =
        prevSelected != null && this.rooms.some((r) => r.id === prevSelected)
          ? prevSelected
          : null;

      // Warm thumbnails so room tiles aren't blank.
      for (const r of this.rooms.slice(0, 12)) {
        void this.ensureRoomPreview(r.id);
      }
    } catch (e) {
      console.error('Failed loading building rooms', e);
      this.rooms = [];
    }
  }

  async createRoomInBuilding() {
    if (this.userId == null) {
      const a = await this.alertController.create({
        header: 'Not logged in',
        message: 'You must be logged in to add a room.',
        buttons: ['OK'],
      });
      await a.present();
      return;
    }
    if (this.activeBuildingId == null) {
      const a = await this.alertController.create({
        header: 'No building selected',
        message: 'Select a building first.',
        buttons: ['OK'],
      });
      await a.present();
      return;
    }

    const alert = await this.alertController.create({
      header: 'New Room',
      inputs: [
        { name: 'name', type: 'text', placeholder: 'Enter new room name' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Create',
          handler: (data) => {
            const name = String(data?.name || '').trim();
            if (!name) return false;
            void this.createRoomWithName(name);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async createRoomWithName(name: string) {
    try {
      const res: any = await firstValueFrom(
        this.floorplanApi.createBuildingRoom(this.activeBuildingId as number, this.userId as number, name)
      );
      if (!res?.success) {
        const a = await this.alertController.create({ header: 'Error', message: res?.error || 'Failed to create room', buttons: ['OK'] });
        await a.present();
        return;
      }
      await this.loadRoomsForBuilding(this.activeBuildingId as number);
      const rid = res.room?.id;
      if (rid != null) {
        this.activeRoomId = Number(rid);
        await Preferences.set({ key: this.KEY_CURRENT_ROOM_ID, value: String(rid) });
      }
    } catch (e) {
      console.error(e);
      const a = await this.alertController.create({ header: 'Error', message: 'Failed to create room', buttons: ['OK'] });
      await a.present();
    }
  }

  async deleteBuilding() {
    if (this.activeBuildingId == null || !this.canDeleteActiveBuilding) return;
    const alert = await this.alertController.create({
      header: 'Delete building?',
      message: 'Delete this building and all of its rooms? This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', cssClass: 'danger', handler: () => { void this.performDeleteBuilding(); } }
      ]
    });
    await alert.present();
  }

  private async performDeleteBuilding() {
    try {
      const res: any = await firstValueFrom(
        this.floorplanApi.deleteBuilding(this.activeBuildingId as number)
      );
      if (!res?.success) {
        const a = await this.alertController.create({ header: 'Error', message: res?.error || 'Failed to delete building', buttons: ['OK'] });
        await a.present();
        return;
      }

      await this.loadBuildingsFromApi();
      this.onSeeAllBuildings();
    } catch (e) {
      console.error(e);
      const a = await this.alertController.create({ header: 'Error', message: 'Failed to delete building', buttons: ['OK'] });
      await a.present();
    }
  }

  async deleteRoom() {
    if (this.activeBuildingId == null || this.activeRoomId == null) return;
    const alert = await this.alertController.create({
      header: 'Delete room?',
      message: 'Delete this room and its floorplan? Items assigned to this room will be unassigned.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', cssClass: 'danger', handler: () => { void this.performDeleteRoom(); } }
      ]
    });
    await alert.present();
  }

  private async performDeleteRoom() {
    try {
      const res: any = await firstValueFrom(
        this.floorplanApi.deleteBuildingRoom(this.activeBuildingId as number, this.activeRoomId as number)
      );
      if (!res?.success) {
        const a = await this.alertController.create({ header: 'Error', message: res?.error || 'Failed to delete room', buttons: ['OK'] });
        await a.present();
        return;
      }

      this.activeRoomId = null;
      if (this.showFloorCanvas) {
        this.closeFloorLayout();
      }
      if (this.activeBuildingId != null) {
        await this.loadRoomsForBuilding(this.activeBuildingId);
      }
    } catch (e) {
      console.error(e);
      const a = await this.alertController.create({ header: 'Error', message: 'Failed to delete room', buttons: ['OK'] });
      await a.present();
    }
  }

  onRoomMouseEnter(room: BuildingRoom, ev?: MouseEvent) {
    this.cancelScheduledHoverClose();
    this.hoveredRoomId = room.id;
    void this.ensureRoomPreview(room.id);
    this.roomHoverStyle = this.computeHoverStyle(
      (ev?.currentTarget as HTMLElement) ?? null,
      this.getRoomHoverSize()
    );
  }

  onRoomHoverEnter() {
    this.cancelScheduledHoverClose();
  }

  onRoomHoverLeave() {
    this.scheduleHoverClose();
  }

  private getRoomHoverSize(): { w: number; h: number } {
    return { w: 380, h: 260 };
  }

  onRoomMouseLeave() {
    this.scheduleHoverClose();
  }

  private scheduleHoverClose() {
    this.cancelScheduledHoverClose();
    this.hoverLeaveTimer = window.setTimeout(() => {
      this.hoveredRoomId = null;
      this.hoveredBuildingId = null;
      this.roomPreviewLoadingId = null;
      this.buildingRoomsLoadingId = null;
      this.roomHoverStyle = {};
      this.buildingHoverStyle = {};
      this.hoverLeaveTimer = null;
    }, 180);
  }

  private cancelScheduledHoverClose() {
    if (this.hoverLeaveTimer != null) {
      window.clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
  }

  private computeHoverStyle(
    _anchorEl: HTMLElement | null,
    approxSize: { w: number; h: number }
  ): Record<string, any> {
    const margin = 12;
    const vw = Math.max(320, window.innerWidth || 0);
    const vh = Math.max(320, window.innerHeight || 0);

    const panelW = Math.min(approxSize.w, vw - margin * 2);
    const panelH = Math.min(approxSize.h, vh - margin * 2);
    const centerX = Math.min(Math.max(panelW / 2 + margin, vw * 0.34), vw - panelW / 2 - margin);
    const centerY = Math.min(Math.max(panelH / 2 + margin, vh * 0.42), vh - panelH / 2 - margin);

    return {
      position: 'fixed',
      left: `${centerX}px`,
      top: `${centerY}px`,
      transform: 'translate(-50%, -50%)',
      width: `${panelW}px`,
      height: `${panelH}px`,
      maxWidth: `calc(100vw - ${margin * 2}px)`,
      maxHeight: `calc(100vh - ${margin * 2}px)`,
      zIndex: 1000000,
    };
  }

  getRoomPreview(roomId: number): RoomPreview | null {
    return this.roomPreviewCache.get(roomId) ?? null;
  }

  getRoomPreviewTransform(roomId: number): string {
    return this.getRoomPreviewTransformFor(roomId, 360, 220);
  }

  getRoomPreviewTransformFor(roomId: number, viewportW: number, viewportH: number, scaleModifier = 1): string {
    const p = this.getRoomPreview(roomId);
    if (!p) return '';
    const scale = Math.min(viewportW / p.contentW, viewportH / p.contentH, 1) * scaleModifier;
    const offsetX = (viewportW - p.contentW * scale) / 2 - p.minX * scale;
    const offsetY = (viewportH - p.contentH * scale) / 2 - p.minY * scale;
    return `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  getRoomPreviewTransformForPadded(
    roomId: number,
    viewportW: number,
    viewportH: number,
    pad: number,
    scaleModifier = 1
  ): string {
    const innerW = Math.max(1, viewportW - pad * 2);
    const innerH = Math.max(1, viewportH - pad * 2);
    const t = this.getRoomPreviewTransformFor(roomId, innerW, innerH, scaleModifier);
    return `translate(${pad}px, ${pad}px) ${t}`;
  }

  private getBuildingHoverSize(roomCount: number): { w: number; h: number } {
    if (roomCount <= 0) return { w: 420, h: 120 };
    if (roomCount === 1) return { w: 520, h: 300 };
    if (roomCount === 2) return { w: 880, h: 300 };
    if (roomCount === 3) return { w: 980, h: 340 };
    return { w: 980, h: 380 };
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
        label: c.label || '',
        x: Number(c.x || 0),
        y: Number(c.y || 0),
        w: Number(c.w || 60),
        h: Number(c.h || 40),
        color: c.color || this.getDefaultColor((c.type || 'cubicle') as FloorItemType),
        locked: !!c.locked,
        createdOrder: Number(c.createdOrder || c.created_order || c.id || 0),
      }));

      let minX = 0, minY = 0, maxX = 1, maxY = 1;
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
      if (this.roomPreviewLoadingId === roomId) this.roomPreviewLoadingId = null;
    }
  }

  private currentNumericRoomId(): number | null {
    const raw = String(this.roomId || '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  async createBuilding() {
    if (this.userId == null) {
      const a = await this.alertController.create({ header: 'Not logged in', message: 'You must be logged in to add a building.', buttons: ['OK'] });
      await a.present();
      return;
    }

    const alert = await this.alertController.create({
      header: 'New building',
      inputs: [{ name: 'name', type: 'text', placeholder: 'Enter new building name' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Create',
          handler: (data) => {
            const displayName = String(data?.name || '').trim();
            if (!displayName) return false;
            void this.createBuildingWithName(displayName);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async createBuildingWithName(displayName: string) {
    const slug = this.slugFromBuildingName(displayName);
    try {
      const res: any = await firstValueFrom(
        this.floorplanApi.createBuilding(this.userId as number, displayName)
      );
      if (!res?.success) {
        const a = await this.alertController.create({ header: 'Error', message: res?.error || 'Failed to create building', buttons: ['OK'] });
        await a.present();
        return;
      }
      await this.loadBuildingsFromApi();
      await this.warmBuildingPreviews();
      const id = res.building?.id;
      if (id != null) {
        this.activeBuildingId = Number(id);
        await Preferences.set({ key: this.KEY_CURRENT_BUILDING, value: String(id) });
        this.roomId = slug;
        await Preferences.set({ key: this.KEY_CURRENT_ROOM, value: this.roomId });
      }
    } catch (e) {
      console.error(e);
      const a = await this.alertController.create({ header: 'Error', message: 'Failed to create building', buttons: ['OK'] });
      await a.present();
    }
  }

  ngOnDestroy() {
    window.removeEventListener('pointermove', this.toolboxMove);
    window.removeEventListener('pointerup', this.toolboxUp);

    window.removeEventListener('pointermove', this.itemMove);
    window.removeEventListener('pointerup', this.itemUp);

    window.removeEventListener('pointermove', this.resizeMove);
    window.removeEventListener('pointerup', this.resizeUp);

    window.removeEventListener('keydown', this.handleKeyDelete);

    if (this.inventoryRefreshInterval) {
      clearInterval(this.inventoryRefreshInterval);
      this.inventoryRefreshInterval = null;
    }
  }

  private async getCurrentUserId(): Promise<number | null> {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (parsed?.id !== undefined && parsed?.id !== null) {
        return Number(parsed.id);
      }
      return null;
    } catch {
      return null;
    }
  }

  async switchRoom(room: string, forceReload = false) {
    if (!forceReload && this.roomId === room) return;

    // Clear old inventory refresh interval before switching rooms
    if (this.inventoryRefreshInterval) {
      clearInterval(this.inventoryRefreshInterval);
      this.inventoryRefreshInterval = null;
    }

    this.roomId = room;
    await Preferences.set({ key: this.KEY_CURRENT_ROOM, value: room });

    this.toolboxOpen = false;
    this.isEditMode = false;
    this.paintMode = false;
    this.addMode = false;
    this.selectedItemId = null;

    await this.loadFloorplanForRoom(room);
  }

  private async loadFloorplanForRoom(room: string) {
    if (!room) {
      this.floorItems = [];
      this.cubicleCount = 1;
      return;
    }

    this.floorplanApi.loadFloorplan(room).subscribe({
      next: (res: any) => {
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
          this.cubicleCount = 1;
        }
      },
      error: (err) => {
        console.error('❌ Load floorplan failed:', err);
        this.floorItems = [];
        this.cubicleCount = 1;
      }
    });

    this.loadFloorplanInventory(room);
  }

  private loadFloorplanInventory(room: string) {
    if (!room) {
      this.cubicleInventory = {};
      return;
    }

    // Clear any existing interval before setting up a new one
    if (this.inventoryRefreshInterval) {
      clearInterval(this.inventoryRefreshInterval);
      this.inventoryRefreshInterval = null;
    }

    // Load inventory immediately
    this.refreshInventoryFromServer(room);

    // Set up auto-refresh every 5 seconds
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
            const key = this.normalizeCubicleLabel(row?.label);
            if (key) {
              this.cubicleInventory[key] = row;
            }
          });
        } else {
          this.cubicleInventory = {};
        }
      },
      error: (err: any) => {
        console.error('❌ Load cubicle inventory failed:', err);
        this.cubicleInventory = {};
      },
    });
  }

  private normalizeCubicleLabel(label: string | null | undefined): string {
    return String(label || '').trim().toLowerCase();
  }

  onCubicleHover(label: string | null) {
    this.hoveredCubicleLabel = label;
  }

  // Transfer helpers
  startTransfer(fromLabel: string) {
    // Start transfer with a preselected source label (keeps old behavior)
    this.openTransferDialog();
    this.transferFromLabel = fromLabel;
    this.transferFromCubicleId = null;
    // try to preselect source id if available
    const key = String(fromLabel || '').trim().toLowerCase();
    const found = this.availableCubicles.find((c) => String(c.label || '').trim().toLowerCase() === key);
    if (found) this.transferFromCubicleId = Number(found.id);
  }

  openTransferDialog() {
    this.transferPanelOpen = true;
    this.transferFromLabel = this.selectedFloorItem?.type === 'cubicle' ? this.selectedFloorItem.label : null;
    this.transferFromCubicleId = null;
    this.transferTargetBuildingId = this.activeBuildingId;
    this.transferTargetRoomId = null;
    this.transferToCubicleId = null;
    this.transferTargetRooms = [];
    this.transferTargetCubicles = [];
    this.transferSelectedTypes = [];
    this.transferSourceItems = [];
    this.transferMode = 'all';
    this.transferAssignedUser = false;
    this.availableCubicles = [];

    if (this.activeRoomId != null) {
      this.floorplanApi.listRoomCubicles(this.activeRoomId).subscribe({
        next: (res: any) => {
            if (res?.success && Array.isArray(res.cubicles)) {
            this.availableCubicles = res.cubicles
              .filter((c: any) => String(c.label || '').trim() !== '')
              .map((c: any) => ({
                id: Number(c.id),
                label: String(c.label || ''),
                assignedUser: c.assignedUser || null,
              }));

            if (this.transferFromLabel) {
              const key = String(this.transferFromLabel || '').trim().toLowerCase();
              const found = this.availableCubicles.find((c) => String(c.label || '').trim().toLowerCase() === key);
              if (found) {
                this.transferFromCubicleId = Number(found.id);
                this.buildTransferSourceItems();
              }
            }

            // Do not auto-check transferAssignedUser; user must opt-in explicitly.
          }
        },
        error: (err: unknown) => {
          console.error('Failed loading cubicles for transfer', err);
          this.availableCubicles = [];
        }
      });
    }

    if (this.transferTargetBuildingId != null) {
      void this.loadTransferTargetRooms(this.transferTargetBuildingId);
    }
  }

  cancelTransfer() {
    this.transferPanelOpen = false;
    this.transferFromLabel = null;
    this.transferFromCubicleId = null;
    this.transferToCubicleId = null;
    this.transferTargetBuildingId = null;
    this.transferTargetRoomId = null;
    this.transferTargetRooms = [];
    this.transferTargetCubicles = [];
    this.transferSelectedTypes = [];
    this.transferAssignedUser = false;
    this.availableCubicles = [];
  }

  get transferSourceAssignedUser(): string | null {
    const currentSource = this.availableCubicles.find((c) => Number(c.id) === Number(this.transferFromCubicleId));
    if (currentSource && currentSource.assignedUser) {
      return String(currentSource.assignedUser);
    }
    const compareLabel = String(this.transferFromLabel || '').trim().toLowerCase();
    if (!compareLabel) return null;
    const sourceByLabel = this.availableCubicles.find((c) => String(c.label || '').trim().toLowerCase() === compareLabel);
    return sourceByLabel?.assignedUser ? String(sourceByLabel.assignedUser) : null;
  }

  toggleTransferType(type: string) {
    const idx = this.transferSelectedTypes.indexOf(type);
    if (idx === -1) this.transferSelectedTypes.push(type);
    else this.transferSelectedTypes.splice(idx, 1);
  }

  onTransferSourceChange() {
    this.buildTransferSourceItems();
  }

  onTransferTargetBuildingChange() {
    this.transferTargetRoomId = null;
    this.transferTargetCubicles = [];
    this.transferToCubicleId = null;
    if (this.transferTargetBuildingId != null) {
      // if storage building selected, don't load rooms/cubicles
      if (this.isStorageBuilding(this.transferTargetBuildingId)) {
        this.transferTargetRooms = [];
        this.transferTargetCubicles = [];
      } else {
        void this.loadTransferTargetRooms(this.transferTargetBuildingId);
      }
    }
  }

  onTransferTargetRoomChange() {
    this.transferToCubicleId = null;
    this.transferTargetCubicles = [];
    if (this.transferTargetRoomId != null) {
      this.loadTransferTargetCubicles(this.transferTargetRoomId);
    }
  }

  isStorageBuilding(buildingId: number | null): boolean {
    if (buildingId == null) return false;
    const b = this.buildings.find((x) => x.id === Number(buildingId));
    if (!b) return false;
    return String(b.building_name || '').trim().toLowerCase() === 'storage';
  }

  private async loadTransferTargetRooms(buildingId: number) {
    try {
      const res: any = await firstValueFrom(this.floorplanApi.listBuildingRooms(buildingId));
      if (res?.success && Array.isArray(res.rooms)) {
        this.transferTargetRooms = res.rooms.map((r: any) => ({
          id: Number(r.id),
          room_name: r.room_name,
          user_id: r.user_id,
          building_id: Number(r.building_id),
          cubicles: Number(r.cubicles || 0),
          itemsAssigned: Number(r.itemsAssigned || 0),
        }));
      } else {
        this.transferTargetRooms = [];
      }
    } catch (e) {
      console.error('Failed loading target rooms', e);
      this.transferTargetRooms = [];
    }
  }

  private loadTransferTargetCubicles(roomId: number) {
    this.floorplanApi.listRoomCubicles(roomId).subscribe({
      next: (res: any) => {
          if (res?.success && Array.isArray(res.cubicles)) {
          this.transferTargetCubicles = res.cubicles
            .filter((c: any) => String(c.label || '').trim() !== '')
            .map((c: any) => ({
              id: Number(c.id),
              label: String(c.label || ''),
              assignedUser: c.assignedUser || null,
            }));
        } else {
          this.transferTargetCubicles = [];
        }
      },
      error: (err: unknown) => {
        console.error('Failed loading target cubicles', err);
        this.transferTargetCubicles = [];
      }
    });
  }

  private buildTransferSourceItems(): void {
    this.transferSourceItems = [];
    if (!this.transferFromCubicleId) return;

    const source = this.availableCubicles.find((c) => Number(c.id) === Number(this.transferFromCubicleId));
    if (!source || !source.label) return;

    const row = this.cubicleInventory[this.normalizeCubicleLabel(source.label)] || {};
    const itemNames = Array.isArray(row.itemNames)
      ? row.itemNames.filter((name: any) => String(name || '').trim() !== '')
      : [];

    this.transferSourceItems = itemNames.map((name: any) => {
      const text = String(name || '').trim();
      let itemType = '';
      let code = text;
      const parts = text.split(':');
      if (parts.length >= 2) {
        itemType = String(parts[0] || '').trim().toLowerCase();
        code = String(parts.slice(1).join(':') || '').trim();
      }
      return {
        label: text,
        type: itemType,
        code,
        selected: false,
      };
    });
  }

  performTransfer() {
    if (!this.transferFromCubicleId) { this.notification.show('Choose a source cubicle'); return; }
    // Allow transfers to building-level storage without choosing a room/cubicle
    if (!this.transferToCubicleId && !this.isStorageBuilding(this.transferTargetBuildingId)) { this.notification.show('Choose a target cubicle'); return; }

    const source = this.availableCubicles.find((c) => Number(c.id) === Number(this.transferFromCubicleId));
    const fromLabel = source ? String(source.label || '') : null;
    if (!fromLabel) { this.notification.show('Invalid source selection'); return; }

    const transferRoomId = this.activeRoomId ?? this.currentNumericRoomId();
    if (transferRoomId == null) {
      this.notification.show('Invalid room selected for transfer');
      return;
    }

    const payload: any = {
      roomId: transferRoomId,
      fromLabel,
      toCubicleId: this.transferToCubicleId,
      transferTargetBuildingId: this.transferTargetBuildingId,
      transferAssignedUser: this.transferAssignedUser,
      transferMode: this.transferMode,
      transferredByUserId: this.userId,
    };

    if (this.transferMode === 'userOnly') {
      if (!this.transferAssignedUser) {
        this.notification.show('Enable Transfer assigned user to move user only');
        return;
      }
      if (this.isStorageBuilding(this.transferTargetBuildingId)) {
        this.notification.show('Cannot transfer assigned user to storage');
        return;
      }
      payload.transferOnlyUser = true;
      payload.transferAssignedUser = true;
      payload.itemCodes = [];
      payload.itemTypes = [];
    } else if (this.transferMode === 'selected') {
      const selectedCodes = this.transferSourceItems
        .filter((item) => item.selected && item.code)
        .map((item) => String(item.code || '').trim())
        .filter((code) => code !== '');

      if (selectedCodes.length) {
        payload.itemCodes = selectedCodes;
      } else if (this.transferSelectedTypes && this.transferSelectedTypes.length) {
        payload.itemTypes = this.transferSelectedTypes;
      } else {
        this.notification.show('Choose items or item types to transfer');
        return;
      }
    }

    this.floorplanApi.transferItems(payload).subscribe({
      next: (res: any) => {
        if (!res?.success) { this.notification.show(res?.error || 'Transfer failed'); return; }
        this.notification.show('Transfer complete');
        this.cancelTransfer();
        if (this.roomId) this.refreshInventoryFromServer(this.roomId);
        // refresh previews and floorplan
        void this.loadFloorplanForRoom(this.roomId || '');
      },
      error: (err) => {
        console.error('Transfer failed', err);
        this.notification.show('Transfer failed');
      }
    });
  }

  getInventoryTooltipLines(label: string): string[] {
    const row = this.cubicleInventory[this.normalizeCubicleLabel(label)] || {};

    const lines: string[] = [];
    const itemNames = Array.isArray(row.itemNames)
      ? row.itemNames.filter((name: any) => String(name || '').trim() !== '')
      : [];
    if (itemNames.length) {
      lines.push(...itemNames.map((name: any) => String(name)));
    } else {
      const fields: Array<[string, any]> = [
        ['Monitor', row.monitors],
        ['Headset', row.headsets],
        ['Camera', row.cameras],
        ['Mouse', row.mouse],
        ['Keyboard', row.keyboards],
        ['Computer', row.computers],
      ];

      for (const [labelText, value] of fields) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) {
          lines.push(`${labelText}: ${n}`);
        }
      }
    }

    if (row.assignedUsers && String(row.assignedUsers).trim() !== '') {
      lines.unshift(`User: ${String(row.assignedUsers).trim()}`);
    }

    return lines.length > 0 ? lines : ['No assigned items'];
  }

  toggleToolbox(editBtn?: HTMLElement) {
    if (!this.toolboxOpen) {
      // entering edit mode
      this.toolboxOpen = true;
      this.isEditMode = true;
      this.hasUnsavedEdits = false;
      this.editSnapshot = {
        floorItems: this.floorItems.map((i) => ({ ...i })),
        cubicleCount: this.cubicleCount,
      };
      this.positionToolboxAboveEdit(editBtn);
      return;
    }

    // leaving edit mode
    if (this.hasUnsavedEdits) {
      const ok = window.confirm(
        'You have unsaved changes. Newly added/edited items will NOT be saved unless you press Save.\n\nExit edit mode and discard changes?'
      );
      if (!ok) return;
      this.discardEditChanges();
    }

    this.toolboxOpen = false;
    this.isEditMode = false;
    this.paintMode = false;
    this.addMode = false;
    this.selectedItemId = null;
    this.hasUnsavedEdits = false;
    this.editSnapshot = null;
    // Reset paint color when exiting edit mode.
    this.selectedColor = this.getDefaultColor(this.selectedItemType);
  }

  closeToolbox() {
    if (!this.toolboxOpen) return;

    if (this.hasUnsavedEdits) {
      const ok = window.confirm(
        'You have unsaved changes. Newly added/edited items will NOT be saved unless you press Save.\n\nExit edit mode and discard changes?'
      );
      if (!ok) return;
      this.discardEditChanges();
    }

    this.toolboxOpen = false;
    this.isEditMode = false;
    this.paintMode = false;
    this.addMode = false;
    this.selectedItemId = null;
    this.hasUnsavedEdits = false;
    this.editSnapshot = null;
    // Reset paint color when exiting edit mode.
    this.selectedColor = this.getDefaultColor(this.selectedItemType);
  }

  async saveEditSettings() {
    await this.saveFloorplanData();

    this.toolboxOpen = false;
    this.isEditMode = false;
    this.paintMode = false;
    this.addMode = false;
    this.selectedItemId = null;
    this.hasUnsavedEdits = false;
    this.editSnapshot = null;
    // Reset paint color when exiting edit mode.
    this.selectedColor = this.getDefaultColor(this.selectedItemType);
  }

  private discardEditChanges() {
    if (!this.editSnapshot) return;
    this.floorItems = this.editSnapshot.floorItems.map((i) => ({ ...i }));
    this.cubicleCount = this.editSnapshot.cubicleCount;
    this.selectedItemId = null;
    this.paintMode = false;
    this.addMode = false;
    this.hasUnsavedEdits = false;
  }

  private async saveFloorplanData() {
    const userId = this.userId ?? 1;
    const layout: FloorplanLayout = { cubicles: this.floorItems };

    this.floorplanApi.saveFloorplan(this.roomId, userId, layout).subscribe({
      next: (res: any) => {
        console.log('✅ Floorplan saved to DB:', res);
        const rid = this.currentNumericRoomId();
        if (rid != null) {
          // Invalidate cached preview so hover reflects new cubicles.
          this.roomPreviewCache.delete(rid);
        }
        if (this.activeBuildingId != null) {
          // Refresh room summary stats (cubicles/itemsAssigned).
          void this.loadRoomsForBuilding(this.activeBuildingId);
        }
      },
      error: (err) => console.error('❌ Floorplan save failed:', err)
    });
  }

  setAddItemType(type: FloorItemType) {
    this.selectedItemType = type;
    this.selectedColor = this.getDefaultColor(type);
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

  private getDefaultSize(type: FloorItemType) {
    switch (type) {
      case 'wall':
        return { w: this.snap(160), h: this.snap(20) };
      case 'door':
        return { w: this.snap(60), h: this.snap(20) };
      case 'table':
        return { w: this.snap(80), h: this.snap(40) };
      case 'cubicle':
      default:
        return { w: this.snap(60), h: this.snap(40) };
    }
  }

  selectColor(color: string) {
    this.selectedColor = color;
  }

  selectItem(id: number, event?: Event) {
    event?.stopPropagation();
    this.selectedItemId = id;
  }

  togglePaintMode() {
    if (!this.isEditMode) return;

    this.paintMode = !this.paintMode;
    if (this.paintMode) this.addMode = false;
    if (!this.paintMode) this.selectedItemId = null;
  }

  toggleAddMode() {
    if (!this.isEditMode) return;

    this.addMode = !this.addMode;
    if (this.addMode) this.paintMode = false;
    if (!this.addMode) this.selectedItemId = null;
  }

  private paintItem(item: FloorItem) {
    item.color = this.selectedColor;
    this.selectedItemId = item.id;
    this.hasUnsavedEdits = true;
  }

  private getNextCreatedOrder(): number {
    if (!this.floorItems.length) return 1;
    return Math.max(...this.floorItems.map(i => Number(i.createdOrder || 0))) + 1;
  }

  async onCanvasClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const clickedOnFloorItem = !!target.closest('.floor-item');
    const clickedOnTransferButton = !!target.closest('.transfer-button');
    const clickedOnModal = !!target.closest('.transfer-modal');

    if (
      !clickedOnFloorItem &&
      !target.closest('.toolbox') &&
      !target.closest('.edit-button') &&
      !clickedOnTransferButton &&
      !clickedOnModal &&
      !target.closest('.fp-bottom-bar') &&
      !target.closest('.fp-toolbar') &&
      !target.closest('.building-overview') &&
      !target.closest('.legend')
    ) {
      this.selectedItemId = null;
    }

    if (!this.isEditMode || !this.addMode) return;

    if (
      clickedOnFloorItem ||
      target.closest('.toolbox') ||
      target.closest('.edit-button') ||
      clickedOnTransferButton ||
      target.closest('.fp-bottom-bar') ||
      target.closest('.fp-toolbar') ||
      target.closest('.building-overview') ||
      target.closest('.legend')
    ) {
      return;
    }

    const area = this.getContentArea();
    const size = this.getDefaultSize(this.selectedItemType);
    const w = size.w;
    const h = size.h;

    let x = this.snap(event.clientX - this.containerLeft());
    let y = this.snap(event.clientY - this.containerTop());

    x = Math.max(area.minX, Math.min(area.maxX - w, x));
    y = Math.max(area.minY, Math.min(area.maxY - h, y));

    const pos =
      this.findNearestFreeSpot(area, w, h, x, y) ||
      this.findFreeSpot(area, w, h, 0, 0);

    if (!pos) return;

    const item: FloorItem = {
      id: Date.now(),
      type: this.selectedItemType,
      label: '',
      x: pos.x,
      y: pos.y,
      w,
      h,
      color: this.getDefaultColor(this.selectedItemType),
      locked: false,
      createdOrder: this.getNextCreatedOrder()
    };

    this.floorItems.push(item);
    this.renumberCubicles();

    this.selectedItemId = item.id;
    this.hasUnsavedEdits = true;
  }

  onToolboxDragStart(e: PointerEvent) {
    this.toolboxDragging = true;
    this.toolboxDragOffsetX = e.clientX - this.toolboxX;
    this.toolboxDragOffsetY = e.clientY - this.toolboxY;

    window.addEventListener('pointermove', this.toolboxMove);
    window.addEventListener('pointerup', this.toolboxUp);
  }

  private onToolboxDragMove(e: PointerEvent) {
    if (!this.toolboxDragging) return;

    const bounds = this.getSafeBoundsForToolbox();
    let x = e.clientX - this.toolboxDragOffsetX;
    let y = e.clientY - this.toolboxDragOffsetY;

    x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
    y = Math.max(bounds.minY, Math.min(bounds.maxY, y));

    this.toolboxX = x;
    this.toolboxY = y;
  }

  private async onToolboxDragEnd() {
    if (!this.toolboxDragging) return;
    this.toolboxDragging = false;

    window.removeEventListener('pointermove', this.toolboxMove);
    window.removeEventListener('pointerup', this.toolboxUp);

    await Preferences.set({
      key: this.KEY_TOOLBOX_POS,
      value: JSON.stringify({ x: this.toolboxX, y: this.toolboxY })
    });
  }

  private positionToolboxAboveEdit(editBtn?: HTMLElement) {
    const margin = 12;
    const bounds = this.getSafeBoundsForToolbox();

    if (!editBtn) {
      this.toolboxX = bounds.maxX;
      this.toolboxY = bounds.maxY;
      return;
    }

    const rect = editBtn.getBoundingClientRect();
    let x = rect.right - this.panelW;
    let y = rect.top - this.panelH - margin;

    x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
    y = Math.max(bounds.minY, Math.min(bounds.maxY, y));

    this.toolboxX = x;
    this.toolboxY = y;
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
    this.cubicleCount = cubicleNumber;
  }

  async deleteItem(id: number) {
    if (!this.isEditMode) return;

    this.floorItems = this.floorItems.filter(item => item.id !== id);

    if (this.selectedItemId === id) {
      this.selectedItemId = null;
    }

    this.renumberCubicles();
    this.hasUnsavedEdits = true;
  }

  onItemPointerDown(e: PointerEvent, item: FloorItem) {
    this.selectedItemId = item.id;

    if (!this.isEditMode) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (this.paintMode) {
      e.preventDefault();
      e.stopPropagation();
      this.paintItem(item);
      return;
    }

    this.onItemDragStart(e, item);
  }

  private onItemDragStart(e: PointerEvent, item: FloorItem) {
    if (!this.isEditMode || this.resizing) return;

    this.itemDragging = true;
    this.dragItemId = item.id;

    this.itemDragOffsetX = e.clientX - this.containerLeft() - item.x;
    this.itemDragOffsetY = e.clientY - this.containerTop() - item.y;

    this.lastDragPointerX = e.clientX;
    this.lastDragPointerY = e.clientY;

    window.addEventListener('pointermove', this.itemMove);
    window.addEventListener('pointerup', this.itemUp);
  }

  private onItemDragMove(e: PointerEvent) {
    if (!this.itemDragging || this.dragItemId == null) return;

    const idx = this.floorItems.findIndex(x => x.id === this.dragItemId);
    if (idx === -1) return;

    const item = this.floorItems[idx];
    const area = this.getContentArea();

    let x = e.clientX - this.containerLeft() - this.itemDragOffsetX;
    let y = e.clientY - this.containerTop() - this.itemDragOffsetY;

    x = this.snap(x);
    y = this.snap(y);

    x = Math.max(area.minX, Math.min(area.maxX - item.w, x));
    y = Math.max(area.minY, Math.min(area.maxY - item.h, y));

    const proposed: FloorItem = { ...item, x, y };
    const collision = this.getFirstCollision(proposed, item.id);

    if (!collision) {
      this.floorItems[idx] = proposed;
      this.lastDragPointerX = e.clientX;
      this.lastDragPointerY = e.clientY;
      return;
    }

    const resolved = this.resolveDragPlacement(proposed, collision, area, e);

    if (resolved && !this.overlapsAny(resolved, item.id)) {
      this.floorItems[idx] = resolved;
    }

    this.lastDragPointerX = e.clientX;
    this.lastDragPointerY = e.clientY;
  }

  private onItemDragEnd = async () => {
    if (!this.itemDragging) return;
    this.itemDragging = false;

    window.removeEventListener('pointermove', this.itemMove);
    window.removeEventListener('pointerup', this.itemUp);

    this.dragItemId = null;
    this.hasUnsavedEdits = true;
  };

  onResizeStart(e: PointerEvent, item: FloorItem, direction: ResizeDirection) {
    e.stopPropagation();
    e.preventDefault();

    if (!this.isEditMode) return;

    this.resizing = true;
    this.resizeItemId = item.id;
    this.resizeDirection = direction;
    this.selectedItemId = item.id;

    this.resizeStart = {
      w: item.w,
      h: item.h,
      x: item.x,
      y: item.y,
      pointerX: e.clientX,
      pointerY: e.clientY
    };

    window.addEventListener('pointermove', this.resizeMove);
    window.addEventListener('pointerup', this.resizeUp);
  }

  private onResizeMove(e: PointerEvent) {
    if (!this.resizing || this.resizeItemId == null || !this.resizeStart || !this.resizeDirection) {
      return;
    }

    const idx = this.floorItems.findIndex(x => x.id === this.resizeItemId);
    if (idx === -1) return;

    const item = this.floorItems[idx];
    const area = this.getContentArea();

    const dx = e.clientX - this.resizeStart.pointerX;
    const dy = e.clientY - this.resizeStart.pointerY;

    let newX = this.resizeStart.x;
    let newY = this.resizeStart.y;
    let newW = this.resizeStart.w;
    let newH = this.resizeStart.h;

    switch (this.resizeDirection) {
      case 'right':
        newW = this.snap(this.resizeStart.w + dx);
        break;

      case 'left':
        newX = this.snap(this.resizeStart.x + dx);
        newW = this.snap(this.resizeStart.w - dx);
        break;

      case 'bottom':
        newH = this.snap(this.resizeStart.h + dy);
        break;

      case 'top':
        newY = this.snap(this.resizeStart.y + dy);
        newH = this.snap(this.resizeStart.h - dy);
        break;

      case 'top-left':
        newX = this.snap(this.resizeStart.x + dx);
        newY = this.snap(this.resizeStart.y + dy);
        newW = this.snap(this.resizeStart.w - dx);
        newH = this.snap(this.resizeStart.h - dy);
        break;

      case 'top-right':
        newY = this.snap(this.resizeStart.y + dy);
        newW = this.snap(this.resizeStart.w + dx);
        newH = this.snap(this.resizeStart.h - dy);
        break;

      case 'bottom-left':
        newX = this.snap(this.resizeStart.x + dx);
        newW = this.snap(this.resizeStart.w - dx);
        newH = this.snap(this.resizeStart.h + dy);
        break;

      case 'bottom-right':
        newW = this.snap(this.resizeStart.w + dx);
        newH = this.snap(this.resizeStart.h + dy);
        break;
    }

    if (newW < this.minItemSize) {
      if (this.resizeDirection.includes('left')) {
        newX = this.resizeStart.x + (this.resizeStart.w - this.minItemSize);
      }
      newW = this.minItemSize;
    }

    if (newH < this.minItemSize) {
      if (this.resizeDirection.includes('top')) {
        newY = this.resizeStart.y + (this.resizeStart.h - this.minItemSize);
      }
      newH = this.minItemSize;
    }

    newX = this.snap(newX);
    newY = this.snap(newY);
    newW = this.snap(newW);
    newH = this.snap(newH);

    if (newX < area.minX) {
      newW = newW - (area.minX - newX);
      newX = area.minX;
    }

    if (newY < area.minY) {
      newH = newH - (area.minY - newY);
      newY = area.minY;
    }

    if (newX + newW > area.maxX) {
      newW = area.maxX - newX;
    }

    if (newY + newH > area.maxY) {
      newH = area.maxY - newY;
    }

    if (newW < this.minItemSize || newH < this.minItemSize) return;

    const next = { ...item, x: newX, y: newY, w: newW, h: newH };
    if (this.overlapsAny(next, item.id)) return;

    this.floorItems[idx] = next;
  }

  private async onResizeEnd() {
    if (!this.resizing) return;

    this.resizing = false;

    window.removeEventListener('pointermove', this.resizeMove);
    window.removeEventListener('pointerup', this.resizeUp);

    this.resizeItemId = null;
    this.resizeDirection = null;
    this.resizeStart = null;
    this.hasUnsavedEdits = true;
  }

  private snap(v: number): number {
    return Math.round(v / this.gridSize) * this.gridSize;
  }

  private toRect(item: FloorItem): RectBox {
    return {
      x1: item.x,
      y1: item.y,
      x2: item.x + item.w,
      y2: item.y + item.h
    };
  }

  private overlaps(a: FloorItem, b: FloorItem): boolean {
    const ra = this.toRect(a);
    const rb = this.toRect(b);

    return ra.x1 < rb.x2 && ra.x2 > rb.x1 && ra.y1 < rb.y2 && ra.y2 > rb.y1;
  }

  private overlapsAny(item: FloorItem, ignoreId: number): boolean {
    return this.floorItems.some(o => o.id !== ignoreId && this.overlaps(item, o));
  }

  private getFirstCollision(item: FloorItem, ignoreId: number): FloorItem | null {
    for (const o of this.floorItems) {
      if (o.id === ignoreId) continue;
      if (this.overlaps(item, o)) return o;
    }
    return null;
  }

  private resolveDragPlacement(
    moving: FloorItem,
    blocker: FloorItem,
    area: { minX: number; minY: number; maxX: number; maxY: number },
    e: PointerEvent
  ): FloorItem | null {
    const dx = e.clientX - this.lastDragPointerX;
    const dy = e.clientY - this.lastDragPointerY;

    const preferHorizontal = Math.abs(dx) >= Math.abs(dy);
    const candidates: FloorItem[] = [];

    if (preferHorizontal) {
      if (dx >= 0) candidates.push({ ...moving, x: blocker.x - moving.w });
      else candidates.push({ ...moving, x: blocker.x + blocker.w });

      candidates.push({ ...moving, y: blocker.y - moving.h });
      candidates.push({ ...moving, y: blocker.y + blocker.h });
    } else {
      if (dy >= 0) candidates.push({ ...moving, y: blocker.y - moving.h });
      else candidates.push({ ...moving, y: blocker.y + blocker.h });

      candidates.push({ ...moving, x: blocker.x - moving.w });
      candidates.push({ ...moving, x: blocker.x + blocker.w });
    }

    for (const candidate of candidates) {
      const normalized = this.normalizeCandidate(candidate, area);
      if (!this.overlapsAny(normalized, moving.id)) {
        return normalized;
      }
    }

    return null;
  }

  private normalizeCandidate(
    item: FloorItem,
    area: { minX: number; minY: number; maxX: number; maxY: number }
  ): FloorItem {
    let x = this.snap(item.x);
    let y = this.snap(item.y);

    x = Math.max(area.minX, Math.min(area.maxX - item.w, x));
    y = Math.max(area.minY, Math.min(area.maxY - item.h, y));

    return { ...item, x, y };
  }

  private createTempItem(x: number, y: number, w: number, h: number): FloorItem {
    return {
      id: -1,
      type: 'cubicle',
      label: '',
      x,
      y,
      w,
      h,
      color: this.selectedColor,
      locked: false,
      createdOrder: 0
    };
  }

  private findFreeSpot(
    area: { minX: number; minY: number; maxX: number; maxY: number },
    w: number,
    h: number,
    startOffsetX: number,
    startOffsetY: number
  ) {
    const safeStartX = Math.max(0, this.snap(startOffsetX));
    const safeStartY = Math.max(0, this.snap(startOffsetY));

    for (let y = area.minY + safeStartY; y <= area.maxY - h; y += this.gridSize) {
      for (let x = area.minX + safeStartX; x <= area.maxX - w; x += this.gridSize) {
        const temp = this.createTempItem(x, y, w, h);
        if (!this.overlapsAny(temp, -1)) return { x, y };
      }
    }

    for (let y = area.minY; y <= area.maxY - h; y += this.gridSize) {
      for (let x = area.minX; x <= area.maxX - w; x += this.gridSize) {
        const temp = this.createTempItem(x, y, w, h);
        if (!this.overlapsAny(temp, -1)) return { x, y };
      }
    }

    return null;
  }

  private findNearestFreeSpot(
    area: { minX: number; minY: number; maxX: number; maxY: number },
    w: number,
    h: number,
    targetX: number,
    targetY: number
  ) {
    const maxRadius = Math.max(area.maxX - area.minX, area.maxY - area.minY);

    for (let radius = 0; radius <= maxRadius; radius += this.gridSize) {
      for (let y = targetY - radius; y <= targetY + radius; y += this.gridSize) {
        for (let x = targetX - radius; x <= targetX + radius; x += this.gridSize) {
          const snappedX = this.snap(x);
          const snappedY = this.snap(y);

          if (
            snappedX < area.minX ||
            snappedY < area.minY ||
            snappedX + w > area.maxX ||
            snappedY + h > area.maxY
          ) {
            continue;
          }

          const temp = this.createTempItem(snappedX, snappedY, w, h);
          if (!this.overlapsAny(temp, -1)) {
            return { x: snappedX, y: snappedY };
          }
        }
      }
    }

    return null;
  }

  private getSafeBoundsForToolbox() {
    const el = this.containerRef?.nativeElement;
    if (!el) {
      return {
        minX: 10,
        minY: 10,
        maxX: window.innerWidth - this.panelW - 10,
        maxY: window.innerHeight - this.panelH - 10
      };
    }

    const rect = el.getBoundingClientRect();
    return {
      minX: rect.left,
      minY: rect.top,
      maxX: rect.right - this.panelW,
      maxY: rect.bottom - this.panelH
    };
  }

  private getContentArea() {
    const el = this.containerRef.nativeElement;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    const padL = parseInt(style.paddingLeft) || 0;
    const padT = parseInt(style.paddingTop) || 0;
    const padR = parseInt(style.paddingRight) || 0;
    const padB = parseInt(style.paddingBottom) || 0;

    return {
      minX: padL,
      minY: padT,
      maxX: rect.width - padR,
      maxY: rect.height - padB
    };
  }

  private containerLeft(): number {
    return this.containerRef.nativeElement.getBoundingClientRect().left;
  }

  private containerTop(): number {
    return this.containerRef.nativeElement.getBoundingClientRect().top;
  }

  private async loadToolboxPos() {
    const { value } = await Preferences.get({ key: this.KEY_TOOLBOX_POS });
    if (!value) return;

    try {
      const pos = JSON.parse(value);
      if (typeof pos.x === 'number') this.toolboxX = pos.x;
      if (typeof pos.y === 'number') this.toolboxY = pos.y;
    } catch {}
  }
}