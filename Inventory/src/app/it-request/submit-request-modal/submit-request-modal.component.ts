import { Component, Input, OnInit } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FloorplanApiService } from '../../services/floorplan-api';
import { UserService } from '../../services/user.service';

type RoomOption = { id: number; name: string };

type AssignedLocation = {
  buildingId: number | null;
  buildingName: string;
  roomId: number | null;
  roomName: string;
  cubicleId: number | null;
  cubicleLabel: string;
};

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

  peripheral = '';
  reason = '';
  isLoadingLocation = true;
  assignedLocation: AssignedLocation = {
    buildingId: null,
    buildingName: '',
    roomId: null,
    roomName: '',
    cubicleId: null,
    cubicleLabel: ''
  };

  peripherals: Array<{ text: string; value: string }> = [];
  private currentUserId: number | null = null;

  constructor(
    private modalController: ModalController,
    private floorplanApi: FloorplanApiService,
    private userService: UserService
  ) {}

  async ngOnInit() {
    this.currentUserId = this.getCurrentUserId();
    await Promise.all([
      this.loadAssignedLocation(),
      this.loadPeripherals(),
    ]);
  }

  private async loadAssignedLocation() {
    const fallbackUser = this.getCurrentUser();
    this.assignedLocation = {
      buildingId: this.toNumberOrNull(fallbackUser?.building_id),
      buildingName: String(fallbackUser?.building_name || '').trim(),
      roomId: this.toNumberOrNull(fallbackUser?.room_id),
      roomName: String(fallbackUser?.room_name || '').trim(),
      cubicleId: this.toNumberOrNull(fallbackUser?.cubicle_id),
      cubicleLabel: String(fallbackUser?.cubicle_label || '').trim()
    };

    await new Promise<void>((resolve) => {
      if (!this.currentUserId) {
        this.isLoadingLocation = false;
        resolve();
        return;
      }

      this.userService.getUsers().subscribe({
        next: (res: any) => {
          const user = res?.success && Array.isArray(res.users)
            ? res.users.find((item: any) => Number(item?.id) === this.currentUserId)
            : null;

          if (user) {
            this.assignedLocation = {
              buildingId: this.toNumberOrNull(user.building_id),
              buildingName: String(user.building_name || '').trim(),
              roomId: this.toNumberOrNull(user.room_id),
              roomName: String(user.room_name || '').trim(),
              cubicleId: this.toNumberOrNull(user.cubicle_id),
              cubicleLabel: String(user.cubicle_label || '').trim()
            };
          }
          this.isLoadingLocation = false;
          resolve();
        },
        error: (err) => {
          console.error('Load assigned location for request modal failed:', err);
          this.isLoadingLocation = false;
          resolve();
        },
      });
    });
  }

  private getCurrentUser(): any | null {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private getCurrentUserId(): number | null {
    const parsed = this.getCurrentUser();
    if (parsed?.id !== undefined && parsed?.id !== null) {
      const id = Number(parsed.id);
      return Number.isFinite(id) ? id : null;
    }
    return null;
  }

  private toNumberOrNull(value: unknown): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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
    if (this.assignedLocation.buildingId == null || !this.assignedLocation.buildingName) {
      alert('No building has been assigned by IT admin yet.');
      return;
    }

    if (this.assignedLocation.roomId == null || !this.assignedLocation.roomName) {
      alert('No room has been assigned by IT admin yet.');
      return;
    }

    if (this.assignedLocation.cubicleId == null || !this.assignedLocation.cubicleLabel) {
      alert('No cubicle has been assigned by IT admin yet.');
      return;
    }

    if (!this.peripheral) {
      alert('Please select a Peripheral');
      return;
    }

    this.modalController.dismiss({
      buildingId: this.assignedLocation.buildingId,
      buildingName: this.assignedLocation.buildingName,
      roomId: this.assignedLocation.roomId,
      roomName: this.assignedLocation.roomName,
      cubicleId: this.assignedLocation.cubicleId,
      cubicleNumber: this.assignedLocation.cubicleLabel,
      peripheral: this.peripheral,
      reason: this.reason.trim()
    });
  }
}
