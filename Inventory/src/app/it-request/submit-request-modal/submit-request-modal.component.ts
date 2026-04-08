import { Component, Input, OnInit } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FloorplanApiService } from '../../services/floorplan-api';

@Component({
  selector: 'app-submit-request-modal',
  templateUrl: './submit-request-modal.component.html',
  styleUrls: ['./submit-request-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, CommonModule]
})
export class SubmitRequestModalComponent implements OnInit {
  @Input() roomOptions: string[] = [];
  @Input() floorplanRows: Array<{ room_id?: string; label?: string }> = [];

  roomId = '';
  cubicleOptions: string[] = [];
  cubicleNumber = '';
  peripheral = '';
  reason = '';

  peripherals = [
    { text: 'Monitor', value: 'monitor' },
    { text: 'Headset', value: 'headset' },
    { text: 'Webcam', value: 'webcam' },
    { text: 'Mouse', value: 'mouse' },
    { text: 'Keyboard', value: 'keyboard' },
    { text: 'Computer', value: 'computer' }
  ];

  constructor(
    private modalController: ModalController,
    private floorplanApi: FloorplanApiService
  ) {}

  ngOnInit() {
    const hasRows = Array.isArray(this.floorplanRows) && this.floorplanRows.length > 0;
    const hasRooms = Array.isArray(this.roomOptions) && this.roomOptions.length > 0;

    if (hasRows && hasRooms) {
      this.normalizeFloorplanRows();
      this.pickInitialRoom();
      return;
    }

    this.loadFloorplanFromServer();
  }

  private normalizeFloorplanRows() {
    this.floorplanRows = this.floorplanRows.map((row) => ({
      room_id: row.room_id != null ? String(row.room_id) : '',
      label: row.label
    }));
    this.roomOptions = [...new Set(
      this.floorplanRows
        .map((fp) => fp.room_id)
        .filter((roomId): roomId is string => typeof roomId === 'string' && roomId.trim().length > 0)
    )].sort((a, b) => a.localeCompare(b));
  }

  private loadFloorplanFromServer() {
    this.floorplanApi.listFloorplans().subscribe({
      next: (response: any) => {
        if (response?.success && Array.isArray(response.floorplans)) {
          this.floorplanRows = response.floorplans.map((item: any) => ({
            room_id: item.room_id != null ? String(item.room_id) : '',
            label: item.label
          }));
          this.roomOptions = [...new Set(
            this.floorplanRows
              .map((fp) => fp.room_id)
              .filter((roomId): roomId is string => typeof roomId === 'string' && roomId.trim().length > 0)
          )].sort((a, b) => a.localeCompare(b));
          this.pickInitialRoom();
        }
      },
      error: (err) => console.error('Load floorplans for request modal failed:', err)
    });
  }

  private pickInitialRoom() {
    if (this.roomOptions.length) {
      this.roomId = this.roomOptions[0];
      this.updateCubicleOptions();
    }
  }

  onRoomChange() {
    this.updateCubicleOptions();
    this.cubicleNumber = '';
  }

  private updateCubicleOptions() {
    if (!this.roomId) {
      this.cubicleOptions = [];
      return;
    }

    const rid = String(this.roomId);
    this.cubicleOptions = [...new Set(
      this.floorplanRows
        .filter(
          (item) =>
            String(item.room_id) === rid &&
            item.label &&
            item.label !== '__ROOM__'
        )
        .map((item) => (item.label || '').trim())
        .filter((label): label is string => label.length > 0)
    )].sort((a, b) => a.localeCompare(b));
  }

  dismiss() {
    this.modalController.dismiss();
  }

  submit() {
    if (!this.roomId) {
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

    this.modalController.dismiss({
      roomId: String(this.roomId).trim(),
      cubicleNumber: this.cubicleNumber.trim(),
      peripheral: this.peripheral,
      reason: this.reason.trim()
    });
  }
}
