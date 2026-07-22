import { Component, OnInit } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { UserService } from '../services/user.service';
import { FloorplanApiService } from '../services/floorplan-api';
import { NotificationService } from '../services/notification.service';

@Component({
  selector: 'app-add-user-modal',
  standalone: true,
  imports: [IonicModule, FormsModule, CommonModule],
  templateUrl: './add-user-modal.component.html',
  styleUrls: ['./add-user-modal.component.scss']
})
export class AddUserModalComponent {
  username = '';
  role = 'USER';
  password = '';
  confirmPassword = '';
  roles = ['USER', 'IT'];
  passwordVisible = false;
  confirmPasswordVisible = false;
  buildings: any[] = [];
  rooms: any[] = [];
  cubicles: any[] = [];
  buildingId: number | null = null;
  roomId: number | null = null;
  cubicleId: number | null = null;

  constructor(
    private modalCtrl: ModalController,
    private userService: UserService,
    private floorplanApi: FloorplanApiService,
    private notification: NotificationService
  ) {}

  async ngOnInit() {
    await this.loadBuildings();
  }

  private async getCurrentUserId(): Promise<number | null> {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.id !== undefined && parsed?.id !== null) {
        const id = Number(parsed.id);
        return Number.isFinite(id) ? id : null;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async loadBuildings(): Promise<void> {
    const userId = await this.getCurrentUserId();
    this.floorplanApi.listBuildings(userId ?? undefined).subscribe({
      next: (res: any) => {
        this.buildings = res?.success && Array.isArray(res.buildings) ? res.buildings.filter((b: any) => String(b.building_name || '').trim().toLowerCase() !== 'storage') : [];
      },
      error: (err) => {
        console.error('Failed to load buildings', err);
        this.buildings = [];
      }
    });
  }

  onBuildingChange(): void {
    this.roomId = null;
    this.cubicleId = null;
    this.rooms = [];
    this.cubicles = [];
    if (this.buildingId) this.loadRooms(this.buildingId);
  }

  private loadRooms(buildingId: number): void {
    this.floorplanApi.listBuildingRooms(Number(buildingId)).subscribe({
      next: (res: any) => {
        this.rooms = res?.success && Array.isArray(res.rooms) ? res.rooms : [];
      },
      error: (err) => {
        console.error('Failed to load rooms', err);
        this.rooms = [];
      }
    });
  }

  onRoomChange(): void {
    this.cubicleId = null;
    this.cubicles = [];
    if (this.roomId) this.loadCubicles(this.roomId);
  }

  private loadCubicles(roomId: number): void {
    this.floorplanApi.listRoomCubicles(Number(roomId)).subscribe({
      next: (res: any) => {
        const allCubicles = res?.success && Array.isArray(res.cubicles) ? res.cubicles : [];
        this.cubicles = allCubicles.filter((cubicle: any) => {
          const assigned = cubicle?.assignedUser;
          const label = String(cubicle?.label ?? '').trim();
          return label !== '' && (assigned == null || String(assigned).trim() === '');
        });
      },
      error: (err) => {
        console.error('Failed to load cubicles', err);
        this.cubicles = [];
      }
    });
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  submit(): void {
    const username = String(this.username || '').trim();
    const password = String(this.password || '');
    const confirmPassword = String(this.confirmPassword || '');

    if (!username) {
      this.notification.show('Username is required.');
      return;
    }

    if (!password) {
      this.notification.show('Password is required.');
      return;
    }

    if (password !== confirmPassword) {
      this.notification.show('Passwords do not match.');
      return;
    }

    const payload: any = {
      username,
      password,
      role: String(this.role || 'USER').trim().toUpperCase()
    };

    this.userService.createUser(payload).subscribe(
      (res) => {
        if (res?.success) {
          const newUser = res.user;
          // If location selected, assign it after creation
          const assignPayload: any = {};
          if (this.buildingId) assignPayload.building_id = Number(this.buildingId);
          if (this.roomId) assignPayload.room_id = Number(this.roomId);
          if (this.cubicleId) assignPayload.cubicle_id = Number(this.cubicleId);

          if (newUser?.['id'] && Object.keys(assignPayload).length) {
            this.userService.assignLocation(Number(newUser['id']), assignPayload).subscribe({
              next: () => this.modalCtrl.dismiss({ refresh: true }),
              error: () => this.modalCtrl.dismiss({ refresh: true })
            });
          } else {
            this.modalCtrl.dismiss({ refresh: true });
          }
        } else {
          this.notification.show(res?.error || 'Failed to create user.');
        }
      },
      (err) => {
        console.error('Create user failed', err);
        this.notification.show('Failed to create user.');
      }
    );
  }
  
  togglePasswordVisibility(): void {
    this.passwordVisible = !this.passwordVisible;
  }

  toggleConfirmPasswordVisibility(): void {
    this.confirmPasswordVisible = !this.confirmPasswordVisible;
  }
}
