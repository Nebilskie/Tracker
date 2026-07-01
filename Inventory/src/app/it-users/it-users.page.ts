import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ModalController } from '@ionic/angular';
import { UserService, UserRecord } from '../services/user.service';
import { FloorplanApiService } from '../services/floorplan-api';
import { AddUserModalComponent } from './add-user-modal.component';
import { AutoRefreshService } from '../services/auto-refresh.service';

export interface ColumnDef {
  key: string;
  label: string;
}

@Component({
  selector: 'app-it-users',
  templateUrl: './it-users.page.html',
  styleUrls: ['./it-users.page.scss'],
  standalone: false
})
export class ItUsersPage implements OnInit, OnDestroy {
  columns: ColumnDef[] = [];
  users: UserRecord[] = [];
  filteredUsers: UserRecord[] = [];
  pagedUsers: UserRecord[] = [];
  roles: string[] = ['IT', 'USER'];
  selectedRole = '';
  filterBuildingId = '';
  filterRoomId = '';
  searchTerm = '';
  pageSize = 20;
  currentPage = 1;
  totalRows = 0;
  totalPages = 1;
  showImportStatus = '';
  showExportDropdown = false;
  visiblePasswordUsers = new Set<string>();

  buildings: any[] = [];
  filterRooms: any[] = [];
  rooms: any[] = [];
  cubicles: any[] = [];

  selectedAssignmentUser: UserRecord | null = null;
  assignmentModel = {
    building_id: '',
    room_id: '',
    cubicle_id: ''
  };
  private refreshSubscription: Subscription | null = null;

  constructor(
    private userService: UserService,
    private floorplanApi: FloorplanApiService,
    private modalController: ModalController,
    private autoRefreshService: AutoRefreshService
  ) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.export-wrapper')) {
      this.showExportDropdown = false;
    }
  }

  ngOnInit() {
    this.refreshSubscription = this.autoRefreshService.watch(async () => {
      this.loadUsers();
      await this.loadBuildings();
    });
  }

  ngOnDestroy() {
    this.refreshSubscription?.unsubscribe();
    this.refreshSubscription = null;
  }

  async openAddUserModal(): Promise<void> {
    const modal = await this.modalController.create({
      component: AddUserModalComponent,
      cssClass: 'request-modal-container',
      showBackdrop: false
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.refresh) {
      this.loadUsers();
    }
  }

  loadUsers() {
    this.userService.getUsers().subscribe(
      (res) => {
        if (res?.success && Array.isArray(res.users)) {
          this.users = res.users;
        } else {
          this.users = [];
        }
        this.buildColumns();
        this.applySearch();
      },
      (err) => {
        console.error('Failed to load users', err);
        this.users = [];
        this.buildColumns();
        this.applySearch();
      }
    );
  }

  buildColumns() {
    if (this.users.length === 0) {
      this.columns = [
        { key: 'id', label: 'ID' },
        { key: 'username', label: 'Username' },
        { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role' }
      ];
      return;
    }

    const excludedKeys = new Set(['building_id', 'room_id', 'cubicle_id']);
    const keys = Object.keys(this.users[0]).filter((key) => !excludedKeys.has(key));
    this.columns = keys.map((key) => ({
      key,
      label: String(key)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (chr) => chr.toUpperCase())
    }));
  }

  applySearch() {
    const term = String(this.searchTerm || '').toLowerCase().trim();
    const roleFilter = String(this.selectedRole || '').toLowerCase().trim();

    const buildingFilter = this.parseNumberOrNull(this.filterBuildingId);
    const roomFilter = this.parseNumberOrNull(this.filterRoomId);

    this.filteredUsers = this.users.filter((user) => {
      const matchesRole = !roleFilter || String(user['role'] || '').toLowerCase() === roleFilter;
      if (!matchesRole) return false;

      if (buildingFilter && Number(user['building_id']) !== buildingFilter) return false;
      if (roomFilter && Number(user['room_id']) !== roomFilter) return false;

      if (!term) return true;
      return this.columns.some((col) =>
        String(user[col.key] ?? '')
          .toLowerCase()
          .includes(term)
      );
    });

    this.currentPage = 1;
    this.paginate();
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, idx) => idx + 1);
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalRows);
  }

  paginate() {
    this.totalRows = this.filteredUsers.length;
    this.totalPages = Math.max(1, Math.ceil(this.totalRows / this.pageSize));
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
    const start = (this.currentPage - 1) * this.pageSize;
    this.pagedUsers = this.filteredUsers.slice(start, start + this.pageSize);
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.paginate();
  }

  filterByRole() {
    this.applySearch();
  }

  onFilterBuildingChange(): void {
    this.filterRoomId = '';
    this.filterRooms = [];
    if (this.filterBuildingId) {
      this.loadFilterRooms(this.filterBuildingId);
    }
    this.applySearch();
  }

  private loadFilterRooms(buildingId: string | number): void {
    const id = this.parseNumberOrNull(String(buildingId));
    if (!id) {
      this.filterRooms = [];
      return;
    }

    this.floorplanApi.listBuildingRooms(id).subscribe(
      (res) => {
        this.filterRooms = res?.success && Array.isArray(res.rooms) ? res.rooms : [];
      },
      (err) => {
        console.error('Failed to load filter rooms', err);
        this.filterRooms = [];
      }
    );
  }

  toggleExportDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.showExportDropdown = !this.showExportDropdown;
  }

  exportData(format: string, scope: 'current' | 'all') {
    const dataRows = scope === 'current' ? this.pagedUsers : this.filteredUsers;
    this.showExportDropdown = false;
    if (format === 'csv') {
      this.downloadCSV(dataRows);
      return;
    }
    this.downloadSpreadsheet(dataRows, format === 'xlsx' ? 'xlsx' : 'ods');
  }

  copyNamesToClipboard() {
    this.showExportDropdown = false;
    const names = this.filteredUsers
      .map((user) => String(user['username'] ?? ''))
      .filter(Boolean)
      .join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(names).then(() => console.log('copied'));
    } else {
      alert('Clipboard API not available');
    }
  }

  getUserKey(user: UserRecord): string {
    return String(user['id'] ?? user['username'] ?? JSON.stringify(user));
  }

  isPasswordVisible(user: UserRecord): boolean {
    return this.visiblePasswordUsers.has(this.getUserKey(user));
  }

  togglePasswordVisibility(user: UserRecord): void {
    const key = this.getUserKey(user);
    if (this.visiblePasswordUsers.has(key)) {
      this.visiblePasswordUsers.delete(key);
    } else {
      this.visiblePasswordUsers.add(key);
    }
  }

  getPasswordDisplay(user: UserRecord): string {
    return this.isPasswordVisible(user) ? String(user['password'] ?? '') : '••••••••';
  }

  getAssignButtonLabel(user: UserRecord): string {
    return user['building_id'] != null && user['room_id'] != null && user['cubicle_id'] != null
      ? 'Reassign'
      : 'Assign';
  }

  startAssign(user: UserRecord): void {
    this.selectedAssignmentUser = user;
    this.assignmentModel = {
      building_id: user['building_id'] != null ? String(user['building_id']) : '',
      room_id: user['room_id'] != null ? String(user['room_id']) : '',
      cubicle_id: user['cubicle_id'] != null ? String(user['cubicle_id']) : ''
    };

    this.loadBuildings();
    if (this.assignmentModel.building_id) {
      this.loadRooms(this.assignmentModel.building_id);
    } else {
      this.rooms = [];
      this.cubicles = [];
    }
    if (this.assignmentModel.room_id) {
      this.loadCubicles(this.assignmentModel.room_id);
    } else {
      this.cubicles = [];
    }
  }

  cancelAssignment(): void {
    this.selectedAssignmentUser = null;
  }

  hasLocationAssignment(user: UserRecord | null): boolean {
    if (!user) return false;
    return user['building_id'] != null || user['room_id'] != null || user['cubicle_id'] != null;
  }

  saveAssignment(): void {
    if (!this.selectedAssignmentUser) {
      return;
    }

    this.submitAssignment(this.buildAssignmentPayload(), false);
  }

  removeAssignment(): void {
    if (!this.selectedAssignmentUser) return;

    const username = String(this.selectedAssignmentUser['username'] || this.selectedAssignmentUser['id']);
    const shouldRemove = confirm(
      `Remove all location assignment for ${username}? This will clear building, room, and cubicle.`
    );
    if (!shouldRemove) return;

    this.submitAssignment({ building_id: null, room_id: null, cubicle_id: null }, false);
  }

  private buildAssignmentPayload(): {
    building_id: number | null;
    room_id: number | null;
    cubicle_id?: number | null;
  } {
    const payload: {
      building_id: number | null;
      room_id: number | null;
      cubicle_id?: number | null;
    } = {
      building_id: this.parseNumberOrNull(this.assignmentModel.building_id),
      room_id: this.parseNumberOrNull(this.assignmentModel.room_id)
    };

    if (this.assignmentModel.cubicle_id.trim()) {
      payload.cubicle_id = this.parseNumberOrNull(this.assignmentModel.cubicle_id);
    }

    return payload;
  }

  private submitAssignment(
    payload: { building_id: number | null; room_id: number | null; cubicle_id?: number | null },
    forceReassign: boolean
  ): void {
    if (!this.selectedAssignmentUser) return;

    const userId = Number(this.selectedAssignmentUser['id']);
    const requestPayload = forceReassign ? { ...payload, force_reassign: true } : payload;

    this.userService.assignLocation(userId, requestPayload).subscribe(
      (res) => {
        if (res?.success) {
          this.handleAssignmentSuccess(res.user || null);
          return;
        }

        if (res?.code === 'CUBICLE_OCCUPIED' && !forceReassign) {
          this.promptForceReassign(payload, res?.conflictUser?.username || null);
        } else {
          alert(res?.error || 'Failed to assign location');
        }
      },
      (err) => {
        if (err?.error?.code === 'CUBICLE_OCCUPIED' && !forceReassign) {
          this.promptForceReassign(payload, err?.error?.conflictUser?.username || null);
          return;
        }
        console.error('Location assignment failed', err);
        alert(err?.error?.error || 'Failed to assign location');
      }
    );
  }

  private promptForceReassign(
    payload: { building_id: number | null; room_id: number | null; cubicle_id?: number | null },
    occupantUsername: string | null
  ): void {
    const message = occupantUsername
      ? `This cubicle is currently assigned to ${occupantUsername}. Do you want to reassign it and remove their location assignment?`
      : 'This cubicle is currently assigned to another user. Do you want to reassign it and remove their location assignment?';

    if (confirm(message)) {
      this.submitAssignment(payload, true);
    }
  }

  private handleAssignmentSuccess(updatedUser: UserRecord | null): void {
    if (!this.selectedAssignmentUser) return;

    const username = String(this.selectedAssignmentUser['username'] ?? 'user');
    const isCleared =
      updatedUser != null &&
      updatedUser['building_id'] == null &&
      updatedUser['room_id'] == null &&
      updatedUser['cubicle_id'] == null;

    this.showImportStatus = isCleared
      ? `Removed location assignment for ${username}.`
      : `Assigned ${username} to location.`;

    const currentUser = localStorage.getItem('user');
    if (currentUser && this.selectedAssignmentUser && updatedUser) {
      const userData = JSON.parse(currentUser);
      if (userData.id === Number(this.selectedAssignmentUser['id'])) {
        localStorage.setItem('user', JSON.stringify({ ...userData, ...updatedUser }));
      }
    }

    this.loadUsers();
    this.selectedAssignmentUser = null;
  }

  private parseNumberOrNull(value: string): number | null {
    const num = Number(String(value).trim());
    return Number.isFinite(num) ? num : null;
  }

  async loadBuildings(): Promise<void> {
    const userId = await this.getCurrentUserId();
    this.floorplanApi.listBuildings(userId ?? undefined).subscribe(
      (res) => {
        this.buildings = res?.success && Array.isArray(res.buildings) ? res.buildings : [];
      },
      (err) => {
        console.error('Failed to load buildings', err);
        this.buildings = [];
      }
    );
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
      // ignore malformed data
    }
    return null;
  }

  loadRooms(buildingId: string | number): void {
    const id = this.parseNumberOrNull(String(buildingId));
    if (!id) {
      this.rooms = [];
      return;
    }

    this.floorplanApi.listBuildingRooms(id).subscribe(
      (res) => {
        this.rooms = res?.success && Array.isArray(res.rooms) ? res.rooms : [];
        if (this.assignmentModel.room_id) {
          this.loadCubicles(this.assignmentModel.room_id);
        }
      },
      (err) => {
        console.error('Failed to load rooms', err);
        this.rooms = [];
      }
    );
  }

  loadCubicles(roomId: string | number): void {
    const id = this.parseNumberOrNull(String(roomId));
    if (!id) {
      this.cubicles = [];
      return;
    }

    this.floorplanApi.listRoomCubicles(id).subscribe(
      (res) => {
        const allCubicles = res?.success && Array.isArray(res.cubicles) ? res.cubicles : [];
        this.cubicles = allCubicles.filter((cubicle: any) => {
          const assigned = cubicle?.assignedUser;
          return assigned == null || String(assigned).trim() === '';
        });
      },
      (err) => {
        console.error('Failed to load cubicles', err);
        this.cubicles = [];
      }
    );
  }

  onBuildingChange(): void {
    this.assignmentModel.room_id = '';
    this.assignmentModel.cubicle_id = '';
    this.rooms = [];
    this.cubicles = [];
    if (this.assignmentModel.building_id) {
      this.loadRooms(this.assignmentModel.building_id);
    }
  }

  onRoomChange(): void {
    this.assignmentModel.cubicle_id = '';
    this.cubicles = [];
    if (this.assignmentModel.room_id) {
      this.loadCubicles(this.assignmentModel.room_id);
    }
  }

  onImportFile(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      try {
        const csvData = this.parseCSV(text);
        if (!csvData.length) {
          alert('No rows found in CSV file.');
          return;
        }
        this.userService.importUsers(csvData).subscribe(
          (res) => {
            if (res?.success) {
              this.showImportStatus = `Imported ${res.imported} users.`;
              this.loadUsers();
            } else {
              alert((res.errors && res.errors[0]) || 'Failed to import users');
            }
          },
          (err) => {
            console.error('User import failed', err);
            alert('Failed to import users');
          }
        );
      } catch (err) {
        console.error('CSV parse error', err);
        alert('Failed to parse CSV file.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  private parseCSV(text: string): UserRecord[] {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return [];

    const headers = this.parseCSVRow(lines[0]).map((h) =>
      String(h || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
    );

    return lines.slice(1).map((line) => {
      const values = this.parseCSVRow(line);
      const row: UserRecord = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? '';
      });
      return row;
    });
  }

  private downloadCSV(data: UserRecord[]) {
    const headers = this.columns.map((c) => c.label);
    const rows = data.map((row) =>
      this.columns.map((c) => '"' + String(row[c.key] ?? '').replace(/"/g, '""') + '"')
    );
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    this.triggerDownload(csv, 'users.csv', 'text/csv');
  }

  private downloadSpreadsheet(data: UserRecord[], ext: 'xlsx' | 'ods') {
    const headers = this.columns.map((c) => c.label);
    const sheetRows = data.map((row) => this.columns.map((c) => String(row[c.key] ?? '')));
    let html = '<html><head><meta charset="UTF-8"></head><body><table border="1">';
    html += '<tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr>';
    sheetRows.forEach((r) => {
      html += '<tr>' + r.map((v) => `<td>${v}</td>`).join('') + '</tr>';
    });
    html += '</table></body></html>';
    const mime = ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.oasis.opendocument.spreadsheet';
    this.triggerDownload(html, `users.${ext}`, mime);
  }

  private triggerDownload(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private parseCSVRow(row: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (inQuotes && row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }
}
