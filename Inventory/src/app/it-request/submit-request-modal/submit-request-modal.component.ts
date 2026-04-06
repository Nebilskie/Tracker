import { Component, Input, OnInit } from '@angular/core';
import { ModalController, IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-submit-request-modal',
  templateUrl: './submit-request-modal.component.html',
  styleUrls: ['./submit-request-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule, CommonModule]
})

export class SubmitRequestModalComponent {

  @Input() roomOptions: string[] = [];
  @Input() floorplanRows: Array<{ room_id?: string; label?: string }> = [];

  roomId: string = '';
  cubicleOptions: string[] = [];
  cubicleNumber: string = '';
  peripheral: string = '';
  reason: string = '';

  peripherals = [
    { text: 'Monitor', value: 'monitor' },
    { text: 'Headset', value: 'headset' },
    { text: 'Webcam', value: 'webcam' },
    { text: 'Mouse', value: 'mouse' },
    { text: 'Keyboard', value: 'keyboard' },
    { text: 'Computer', value: 'computer' }
  ];

  constructor(private modalController: ModalController) {}

  ngOnInit() {
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

    this.cubicleOptions = [...new Set(
      this.floorplanRows
        .filter((item) => item.room_id === this.roomId && item.label && item.label !== '__ROOM__')
        .map((item) => (item.label || '').trim())
        .filter((label): label is string => label.length > 0)
    )];
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
      roomId: this.roomId,
      cubicleNumber: this.cubicleNumber.trim(),
      peripheral: this.peripheral,
      reason: this.reason.trim()
    });
  }

}