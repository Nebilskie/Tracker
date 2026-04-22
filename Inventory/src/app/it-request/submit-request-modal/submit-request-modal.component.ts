import { Component, Input, OnInit } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FloorplanApiService } from '../../services/floorplan-api';

type RoomOption = { id: number; name: string };
type BuildingOption = { id: number; name: string };

@Component({
  selector: 'app-submit-request-modal',
  templateUrl: './submit-request-modal.component.html',
  styleUrls: ['./submit-request-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, CommonModule]
})
export class SubmitRequestModalComponent implements OnInit {
  // Optional preloaded rooms (e.g. from parent). If not provided, we load from server.
  @Input() roomsInput: RoomOption[] | null = null;

  rooms: RoomOption[] = [];
  buildings: BuildingOption[] = [];
  buildingId: number | null = null;
  roomId: number | null = null;
  cubicleOptions: string[] = [];
  cubicleNumber = '';
  peripheral = '';
  reason = '';

  peripherals: Array<{ text: string; value: string }> = [];
  private currentUserId: number | null = null;

  constructor(
    private modalController: ModalController,
    private floorplanApi: FloorplanApiService
  ) {}

  async ngOnInit() {
    this.currentUserId = this.getCurrentUserId();
    await Promise.all([
      this.loadBuildings(),
      this.loadRooms(),
      this.loadPeripherals(),
    ]);

    // Default: if we have buildings, user must pick one (so rooms are scoped).
    // If there are no buildings (fresh DB), keep the form empty.
  }

  private async loadBuildings() {
    await new Promise<void>((resolve) => {
      this.floorplanApi.listBuildings(this.currentUserId ?? undefined).subscribe({
        next: (res: any) => {
          if (res?.success && Array.isArray(res.buildings)) {
            this.buildings = res.buildings
              .map((b: any) => ({
                id: Number(b.id),
                name: String(b.building_name || '').trim(),
              }))
              .filter((b: BuildingOption) => Number.isFinite(b.id) && b.id > 0 && b.name.length > 0)
              .sort((a: BuildingOption, b: BuildingOption) => a.name.localeCompare(b.name));
          } else {
            this.buildings = [];
          }
          resolve();
        },
        error: (err) => {
          console.error('Load buildings for request modal failed:', err);
          this.buildings = [];
          resolve();
        },
      });
    });
  }

  private getCurrentUserId(): number | null {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.id !== undefined && parsed?.id !== null) {
        const id = Number(parsed.id);
        return Number.isFinite(id) ? id : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async loadRooms() {
    if (Array.isArray(this.roomsInput) && this.roomsInput.length) {
      this.rooms = this.roomsInput;
      return;
    }

    await new Promise<void>((resolve) => {
      // Default to empty until a building is selected.
      this.rooms = [];
      resolve();
    });
  }

  async onBuildingChange() {
    this.roomId = null;
    this.cubicleNumber = '';
    this.cubicleOptions = [];

    if (this.buildingId == null) {
      this.rooms = [];
      return;
    }

    await new Promise<void>((resolve) => {
      this.floorplanApi.listBuildingRooms(this.buildingId as number).subscribe({
        next: (res: any) => {
          if (res?.success && Array.isArray(res.rooms)) {
            this.rooms = res.rooms
              .map((r: any) => ({
                id: Number(r.id),
                name: String(r.room_name || '').trim(),
              }))
              .filter((r: RoomOption) => Number.isFinite(r.id) && r.id > 0 && r.name.length > 0)
              .sort((a: RoomOption, b: RoomOption) => a.name.localeCompare(b.name));
          } else {
            this.rooms = [];
          }
          resolve();
        },
        error: (err) => {
          console.error('Load building rooms for request modal failed:', err);
          this.rooms = [];
          resolve();
        },
      });
    });

    if (this.rooms.length) {
      this.roomId = this.rooms[0].id;
      await this.updateCubicleOptions();
    }
  }

  get buildingName(): string {
    if (this.buildingId == null) return '';
    return this.buildings.find((b) => b.id === this.buildingId)?.name ?? '';
  }

  private async loadPeripherals() {
    await new Promise<void>((resolve) => {
      this.floorplanApi.listItemTypes().subscribe({
        next: (res: any) => {
          const types: string[] = res?.success && Array.isArray(res.types) ? res.types : [];
          this.peripherals = types
            .map((t) => String(t || '').trim())
            .filter((t) => t.length > 0)
            .map((t) => ({ value: t, text: this.toTitleCase(t) }));
          resolve();
        },
        error: (err) => {
          console.error('Load item types for request modal failed:', err);
          this.peripherals = [];
          resolve();
        },
      });
    });
  }

  async onRoomChange() {
    this.cubicleNumber = '';
    await this.updateCubicleOptions();
  }

  private async updateCubicleOptions() {
    if (this.roomId == null) {
      this.cubicleOptions = [];
      return;
    }

    const roomId = this.roomId;
    await new Promise<void>((resolve) => {
      this.floorplanApi.loadFloorplan(String(roomId)).subscribe({
        next: (res: any) => {
          const cubicles = res?.success ? (res.floorplan?.layout?.cubicles || []) : [];
          const labels = Array.isArray(cubicles)
            ? cubicles
                .map((c: any) => ({
                  type: String(c?.type || c?.itemType || '').toLowerCase(),
                  label: String(c?.label || '').trim(),
                }))
                .filter((c: any) => c.type === 'cubicle' && c.label.length > 0 && c.label !== '__ROOM__')
                .map((c: any) => c.label)
            : [];

          this.cubicleOptions = [...new Set(labels)].sort((a, b) => a.localeCompare(b));
          resolve();
        },
        error: (err) => {
          console.error('Load cubicles for request modal failed:', err);
          this.cubicleOptions = [];
          resolve();
        },
      });
    });
  }

  private toTitleCase(input: string): string {
    return String(input || '')
      .trim()
      .split(/[\s_-]+/g)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  dismiss() {
    this.modalController.dismiss();
  }

  submit() {
    if (this.buildingId == null) {
      alert('Please select a Building');
      return;
    }

    if (this.roomId == null) {
      alert('Please select a Room');
      return;
    }

    if (!this.cubicleNumber) {
      alert('Please select a Cubicle Number');
      return;
    }

    if (!this.peripheral) {
      alert('Please select a Peripheral');
      return;
    }

    const roomName =
      this.rooms.find((r) => r.id === this.roomId)?.name ?? String(this.roomId);

    this.modalController.dismiss({
      buildingId: this.buildingId,
      buildingName: this.buildingName,
      roomId: this.roomId,
      roomName,
      cubicleNumber: this.cubicleNumber.trim(),
      peripheral: this.peripheral,
      reason: this.reason.trim()
    });
  }
}
