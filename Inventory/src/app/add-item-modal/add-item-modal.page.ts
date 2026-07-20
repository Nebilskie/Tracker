import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { NotificationService } from '../services/notification.service';

@Component({
  selector: 'app-add-item-modal',
  templateUrl: './add-item-modal.page.html',
  styleUrls: ['./add-item-modal.page.scss'],
  standalone: false
})
export class AddItemModalPage {

  constructor(private modalCtrl: ModalController, private http: HttpClient, private notification: NotificationService) {}

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

      try {
        const parsed = this.parseCSV(text);
        console.log('Parsed CSV:', parsed);

        // Normalize item_type values (map plural -> singular)
        const normalized = parsed.map((r: any) => {
          const obj: any = {};
          for (const k of Object.keys(r)) obj[k.trim()] = r[k];

          if (obj.item_type) obj.item_type = this.normalizeType(obj.item_type);
          if (obj.type) obj.type = this.normalizeType(obj.type);

          return obj;
        });

        // Send to backend import endpoint that accepts mst_item rows
        this.http.post('/api/items/import', { csvData: normalized }).subscribe({
          next: (res: any) => {
            console.log('Import result', res);
            this.notification.show('Import completed: ' + JSON.stringify(res));
            this.modalCtrl.dismiss();
          },
          error: (err) => {
            console.error('Import error', err);
            this.notification.show('Import failed: ' + (err?.error?.error || err.message || err));
          }
        });
      } catch (e) {
        console.error('CSV parse error', e);
        const msg = e instanceof Error ? e.message : String(e);
        this.notification.show('Failed to parse CSV: ' + msg);
      }
    };

    reader.readAsText(file);
  }

  normalizeType(val: string) {
    if (!val) return val;
    const v = String(val).trim().toLowerCase();
    if (v.endsWith('s')) return v.slice(0, -1);
    return v;
  }

  // Simple CSV parser that handles quoted fields
  parseCSV(text: string) {
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lines.length) return [];
    const headers = this.parseCSVLine(lines[0]);
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCSVLine(lines[i]);
      if (cols.length === 0) continue;
      const row: any = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = cols[j] == null ? '' : cols[j];
      }
      rows.push(row);
    }
    return rows;
  }

  parseCSVLine(line: string) {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { result.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    result.push(cur);
    return result.map(s => s.trim());
  }

}
