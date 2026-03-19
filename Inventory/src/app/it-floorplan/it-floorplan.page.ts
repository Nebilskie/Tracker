import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef
} from '@angular/core';
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

@Component({
  selector: 'app-it-floorplan',
  templateUrl: './it-floorplan.page.html',
  styleUrls: ['./it-floorplan.page.scss'],
  standalone: false
})
export class ItFloorplanPage implements OnInit, OnDestroy {
  @ViewChild('containerRef', { static: false }) containerRef!: ElementRef<HTMLElement>;

  roomId = 'main-office';
  userId: number | null = null;
  rooms: string[] = ['main-office'];

  selectedColor = '#4caf50';
  selectedItemType: FloorItemType = 'cubicle';

  toolboxOpen = false;
  isEditMode = false;
  paintMode = false;
  addMode = false;

  selectedItemId: number | null = null;

  toolboxX = 30;
  toolboxY = 250;

  floorItems: FloorItem[] = [];
  cubicleCount = 1;

  private readonly gridSize = 20;
  private readonly minItemSize = 20;

  private readonly KEY_TOOLBOX_POS = 'floorplan_toolbox_pos';
  private readonly KEY_FLOORPLAN_ROOMS = 'floorplan_rooms';
  private readonly KEY_CURRENT_ROOM = 'floorplan_current_room';

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

  constructor(private floorplanApi: FloorplanApiService) {}

  async ngOnInit() {
    await this.loadToolboxPos();
    await this.loadSavedRooms();

    this.userId = await this.getCurrentUserId();

    const { value: savedRoom } = await Preferences.get({ key: this.KEY_CURRENT_ROOM });
    if (savedRoom) {
      this.roomId = savedRoom;
      if (!this.rooms.includes(savedRoom)) {
        this.rooms.push(savedRoom);
      }
    }

    window.addEventListener('keydown', this.handleKeyDelete);

    await this.loadRoomsFromDb();
    await this.loadFloorplanForRoom(this.roomId);
  }

  ngOnDestroy() {
    window.removeEventListener('pointermove', this.toolboxMove);
    window.removeEventListener('pointerup', this.toolboxUp);

    window.removeEventListener('pointermove', this.itemMove);
    window.removeEventListener('pointerup', this.itemUp);

    window.removeEventListener('pointermove', this.resizeMove);
    window.removeEventListener('pointerup', this.resizeUp);

    window.removeEventListener('keydown', this.handleKeyDelete);
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

  private async loadSavedRooms() {
    const { value } = await Preferences.get({ key: this.KEY_FLOORPLAN_ROOMS });

    if (!value) {
      this.rooms = ['main-office'];
      return;
    }

    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length) {
        this.rooms = [...new Set(parsed)];
      } else {
        this.rooms = ['main-office'];
      }
    } catch {
      this.rooms = ['main-office'];
    }

    if (!this.rooms.includes('main-office')) {
      this.rooms.unshift('main-office');
    }
  }

  private async saveRoomsToPreferences() {
    await Preferences.set({
      key: this.KEY_FLOORPLAN_ROOMS,
      value: JSON.stringify(this.rooms)
    });
  }

  private async loadRoomsFromDb() {
    this.floorplanApi.listFloorplans().subscribe({
      next: async (res: any) => {
        if (res?.success && Array.isArray(res.floorplans)) {
          const dbRooms = res.floorplans
            .map((row: any) => row.room_id)
            .filter((roomId: string) => !!roomId);

          this.rooms = [...new Set(['main-office', ...this.rooms, ...dbRooms])];
          await this.saveRoomsToPreferences();
        }
      },
      error: (err) => console.error('❌ Failed loading rooms from DB:', err)
    });
  }

  async createRoom() {
    const rawName = window.prompt('Enter new room name');
    if (!rawName) return;

    const clean = rawName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean) return;

    if (this.rooms.includes(clean)) {
      alert('Room already exists.');
      return;
    }

    this.rooms = [...this.rooms, clean];
    await this.saveRoomsToPreferences();

    if (this.userId || this.userId === 0) {
      this.floorplanApi.createRoom(clean, this.userId as number).subscribe({
        next: async () => await this.switchRoom(clean),
        error: async (err) => {
          console.error('❌ Failed creating room:', err);
          await this.switchRoom(clean);
        }
      });
    } else {
      await this.switchRoom(clean);
    }
  }

  async switchRoom(room: string) {
    if (this.roomId === room) return;

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
  }

  toggleToolbox(editBtn?: HTMLElement) {
    this.toolboxOpen = !this.toolboxOpen;
    this.isEditMode = this.toolboxOpen;

    if (this.toolboxOpen) {
      this.positionToolboxAboveEdit(editBtn);
    } else {
      this.paintMode = false;
      this.addMode = false;
      this.selectedItemId = null;
    }
  }

  closeToolbox() {
    this.toolboxOpen = false;
    this.isEditMode = false;
    this.paintMode = false;
    this.addMode = false;
    this.selectedItemId = null;
  }

  async saveEditSettings() {
    this.toolboxOpen = false;
    this.isEditMode = false;
    this.paintMode = false;
    this.addMode = false;
    this.selectedItemId = null;

    await this.saveFloorplanData();
  }

  private async saveFloorplanData() {
    const userId = this.userId ?? 1;
    const layout: FloorplanLayout = { cubicles: this.floorItems };

    this.floorplanApi.saveFloorplan(this.roomId, userId, layout).subscribe({
      next: (res: any) => console.log('✅ Floorplan saved to DB:', res),
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
  }

  private getNextCreatedOrder(): number {
    if (!this.floorItems.length) return 1;
    return Math.max(...this.floorItems.map(i => Number(i.createdOrder || 0))) + 1;
  }

  async onCanvasClick(event: MouseEvent) {
    if (!this.isEditMode || !this.addMode) return;

    const target = event.target as HTMLElement;

    if (
      target.closest('.floor-item') ||
      target.closest('.toolbox') ||
      target.closest('.edit-button') ||
      target.closest('.room-tabs-bar') ||
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
    await this.saveFloorplanData();
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
    await this.saveFloorplanData();
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