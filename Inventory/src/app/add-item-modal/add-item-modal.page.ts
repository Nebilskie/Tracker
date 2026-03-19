import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-add-item-modal',
  templateUrl: './add-item-modal.page.html',
  styleUrls: ['./add-item-modal.page.scss'],
  standalone: false
})
export class AddItemModalPage {

  constructor(private modalCtrl: ModalController) {}

  closeModal() {
    this.modalCtrl.dismiss();
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.readCSV(file);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onDrop(event: DragEvent) {
    event.preventDefault();

    if (event.dataTransfer?.files.length) {
      const file = event.dataTransfer.files[0];
      this.readCSV(file);
    }
  }

  readCSV(file: File) {
    const reader = new FileReader();

    reader.onload = () => {
      const text = reader.result as string;
      console.log('CSV Content:', text);

      const rows = text.split('\n');
      console.log(rows);
    };

    reader.readAsText(file);
  }

}
