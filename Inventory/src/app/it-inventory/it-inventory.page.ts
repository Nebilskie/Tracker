import { Component, HostListener, OnInit } from '@angular/core';
import { InventoryService, InventoryItem, InventorySummaryItem } from '../services/inventory.service';
import { FloorplanApiService } from '../services/floorplan-api';

export interface ColumnDef {
  key: string;
  label: string;
}

@Component({
  selector: 'app-it-inventory',
  templateUrl: './it-inventory.page.html',
  styleUrls: ['./it-inventory.page.scss'],
  standalone: false
})
export class ItInventoryPage implements OnInit {
  assetType = '';
  assetTypes: string[] = [];
  assetTitle = 'All Inventory';

  columns: ColumnDef[] = [];
  rows: Record<string, any>[] = [];
  filteredRows: Record<string, any>[] = [];
  pagedRows: Record<string, any>[] = [];

  statusOptions = [
    { value: 'AVAILABLE', label: 'Available' },
    { value: 'USED', label: 'Used' },
    { value: 'DEFECT', label: 'Defect' }
  ];

  // Pagination
  pageSize = 20;
  currentPage = 1;
  totalRows = 0;
  totalPages = 1;

  // Search
  searchTerm = '';

  // Export dropdown
  showExportDropdown = false;

  buildings: any[] = [];
  rooms: any[] = [];
  cubicles: any[] = [];
  locationEditingRowId: number | null = null;
  previousStatusByRowId: Record<number, string> = {};

  constructor(private inventoryService: InventoryService, private floorplanApi: FloorplanApiService) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.export-wrapper')) {
      this.showExportDropdown = false;
    }
  }

  ngOnInit() {
    // Default columns as in design
    this.columns = [
      { key: 'name', label: 'ITEM' },
      { key: 'total', label: 'TOTAL' },
      { key: 'defects', label: 'DEFECTS' },
      { key: 'used', label: 'USED' },
      { key: 'available', label: 'AVAILABLE' }
    ];

    // initialize empty state
    this.rows = [];
    this.filteredRows = [...this.rows];
    this.paginate();

    // Fetch distinct item types from backend and then load initial data
    this.inventoryService.getItemTypes().subscribe(
      (res) => {
        if (res && res.success && Array.isArray(res.types)) {
          this.assetTypes = res.types;
        } else {
          this.assetTypes = [];
        }
      },
      (err) => {
        console.error('Failed to load item types', err);
        this.assetTypes = [];
      }
    );

    // Load summary view by default
    this.loadAssetData();
  }

  displayLabel(type: string) {
    if (!type) return 'All Inventory';
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  get isSummaryView(): boolean {
    return !this.assetType;
  }

  /** From the All Inventory summary, drill into that category's items (matches toolbar filter + detail table). */
  openCategory(row: Record<string, any>) {
    const raw = String(row['name'] ?? '').trim();
    if (!raw) return;
    const match =
      this.assetTypes.find((t) => t.toLowerCase() === raw.toLowerCase()) ?? raw;
    this.assetType = match;
    this.searchTerm = '';
    this.loadAssetData();
  }

  loadAssetDataManual() {
    this.loadAssetData();
  }

  loadAssetData() {
    // No specific type selected -> show summary
    if (!this.assetType) {
      this.assetTitle = 'All Inventory';
      this.columns = [
        { key: 'name', label: 'ITEM' },
        { key: 'total', label: 'TOTAL' },
        { key: 'defects', label: 'DEFECTS' },
        { key: 'used', label: 'USED' },
        { key: 'available', label: 'AVAILABLE' }
      ];

      this.inventoryService.getSummary().subscribe(
        (res) => {
          if (res && res.success && Array.isArray((res as any).summary)) {
            this.rows = (res as any).summary.map((s: InventorySummaryItem) => ({
              name: s.name,
              total: s.total,
              defects: s.defects,
              available: s.available,
              used: s.used
            }));
          } else {
            this.rows = [];
          }
          this.filteredRows = [...this.rows];
          this.currentPage = 1;
          this.paginate();
        },
        (err) => {
          console.error('Failed to load inventory summary', err);
          this.rows = [];
          this.filteredRows = [];
          this.paginate();
        }
      );

      return;
    }

    // Type selected -> list items for that type (UI matches design)
    this.assetTitle = this.displayLabel(this.assetType);
    this.columns = [
      { key: 'name', label: 'NAME' },
      { key: 'status', label: 'STATUS' },
      { key: 'details', label: 'DETAILS' },
      { key: 'brand', label: 'BRAND' },
      { key: 'building', label: 'BUILDING' },
      { key: 'room', label: 'ROOM' },
      { key: 'cubicle', label: 'CUBICLE' }
    ];

    this.inventoryService.getItems(this.assetType).subscribe(
      (res) => {
        if (res && res.success && Array.isArray(res.items)) {
          this.rows = res.items.map((it: any) => {
            const displayName = it.code ?? it.name ?? '';
            const brand = it.manufacturer || it.brand_name || it.brand || '';

            // Prefer explicit item_details column; fall back to model / serial
            const itemDetails = (it.item_details && String(it.item_details).trim()) ? String(it.item_details).trim() : null;
            const detailsParts = [];
            if (it.model) detailsParts.push(it.model);
            if (it.serial_number) detailsParts.push(it.serial_number);
            const fallbackDetails = detailsParts.join(' • ');
            const details = itemDetails || fallbackDetails || '';

            return {
              id: it.id,
              name: displayName,
              status: this.mapItemStatus(it.status),
              details,
              brand,
              building: it.building_name || '',
              room: it.room_name || '',
              cubicle: it.cubicle_label || ''
            } as Record<string, any>;
          });
        } else {
          this.rows = [];
        }
        this.filteredRows = [...this.rows];
        this.currentPage = 1;
        this.paginate();
      },
      (err) => {
        console.error('Failed to load items for type', this.assetType, err);
        this.rows = [];
        this.filteredRows = [];
        this.paginate();
      }
    );
  }

  onSearch() {
    const term = String(this.searchTerm || '').toLowerCase().trim();
    if (!term) {
      this.filteredRows = [...this.rows];
      this.currentPage = 1;
      this.paginate();
      return;
    }

    this.filteredRows = this.rows.filter(row =>
      this.columns.some(col => String(row[col.key] ?? '').toLowerCase().includes(term))
    );

    this.currentPage = 1;
    this.paginate();
  }

  private parseCSV(text: string): any[] {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const rows = lines.slice(1);

    return rows.map(row => {
      const values = this.parseCSVRow(row);
      const obj: any = {};
      headers.forEach((header, i) => {
        const value = values[i] || '';
        obj[header.toLowerCase().replace(/\s+/g, '_')] = value.trim();
      });
      return obj;
    });
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

  private mapItemStatus(status: any): string {
    const normalized = String(status ?? '').trim();
    switch (normalized.toUpperCase()) {
      case '0':
      case 'DEFECT':
      case 'DEFECTS':
      case 'DEFECTIVE':
        return 'DEFECT';
      case '1':
      case 'AVAILABLE':
        return 'AVAILABLE';
      case '2':
      case 'USED':
        return 'USED';
      default:
        return normalized.toUpperCase();
    }
  }

  updateItemStatus(row: Record<string, any>, newStatus: string) {
    if (!row?.['id']) return;

    if (newStatus === 'USED') {
      this.openUsedLocationEditor(row);
      return;
    }

    if (this.locationEditingRowId === row['id']) {
      this.cancelLocationEdit(row);
    }

    const previousStatus = row['status'];
    row['status'] = newStatus;
    this.inventoryService.updateItemStatus(row['id'], newStatus).subscribe(
      () => {
        // Keep the frontend status updated.
      },
      (err) => {
        console.error('Failed to update item status', err);
        row['status'] = previousStatus;
        alert('Failed to change item status. Please try again.');
      }
    );
  }

  openUsedLocationEditor(row: Record<string, any>) {
    if (!row?.['id']) return;

    this.previousStatusByRowId[row['id']] = row['status'];
    row['status'] = 'USED';
    row['selectedBuildingId'] = null;
    row['selectedRoomId'] = null;
    row['selectedCubicleId'] = null;
    this.locationEditingRowId = row['id'];

    if (!this.buildings.length) {
      this.loadBuildings();
    }
  }

  cancelLocationEdit(row: Record<string, any>) {
    if (!row?.['id']) return;

    row['status'] = 'AVAILABLE';
    delete this.previousStatusByRowId[row['id']];

    this.locationEditingRowId = null;
    row['selectedBuildingId'] = null;
    row['selectedRoomId'] = null;
    row['selectedCubicleId'] = null;
    this.rooms = [];
    this.cubicles = [];
  }

  confirmUsedLocation(row: Record<string, any>) {
    if (!row?.['id']) return;

    const buildingId = Number(row['selectedBuildingId']);
    const roomId = Number(row['selectedRoomId']);
    const cubicleId = Number(row['selectedCubicleId']);

    if (!buildingId || !roomId || !cubicleId) {
      alert('Please select building, room, and cubicle before saving.');
      return;
    }

    const payload = {
      building_id: buildingId,
      room_id: roomId,
      cubicle_id: cubicleId
    };

    this.inventoryService.updateItemStatus(row['id'], 'USED', payload).subscribe(
      () => {
        this.locationEditingRowId = null;
        this.loadAssetData();
      },
      (err) => {
        console.error('Failed to update item status with location', err);
        alert('Failed to save item location. Please try again.');
      }
    );
  }

  private loadBuildings() {
    this.floorplanApi.listBuildings().subscribe(
      (res) => {
        this.buildings = res?.success && Array.isArray(res?.buildings) ? res.buildings : [];
      },
      (err) => {
        console.error('Failed to load buildings', err);
        this.buildings = [];
      }
    );
  }

  onBuildingChange(row: Record<string, any>) {
    row['selectedRoomId'] = null;
    row['selectedCubicleId'] = null;
    this.cubicles = [];

    const buildingId = Number(row['selectedBuildingId']);
    if (buildingId) {
      this.loadRooms(buildingId);
    } else {
      this.rooms = [];
    }
  }

  private loadRooms(buildingId: number) {
    this.floorplanApi.listBuildingRooms(buildingId).subscribe(
      (res) => {
        this.rooms = res?.success && Array.isArray(res?.rooms) ? res.rooms : [];
      },
      (err) => {
        console.error('Failed to load rooms for building', buildingId, err);
        this.rooms = [];
      }
    );
  }

  onRoomChange(row: Record<string, any>) {
    row['selectedCubicleId'] = null;
    const roomId = Number(row['selectedRoomId']);
    if (roomId) {
      this.loadCubicles(roomId);
    } else {
      this.cubicles = [];
    }
  }

  private loadCubicles(roomId: number) {
    this.floorplanApi.listRoomCubicles(roomId).subscribe(
      (res) => {
        this.cubicles = res?.success && Array.isArray(res?.cubicles) ? res.cubicles : [];
      },
      (err) => {
        console.error('Failed to load cubicles for room', roomId, err);
        this.cubicles = [];
      }
    );
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
          alert('No rows found in the selected CSV.');
          return;
        }

        const importOp = this.assetType
          ? this.inventoryService.importItems(this.assetType, csvData)
          : this.inventoryService.importBulkItems(csvData);

        importOp.subscribe(
          (res) => {
            if (res && res.success) {
              alert(`Import completed: ${res.imported} imported, ${res.skipped} skipped.`);
              this.loadAssetData();
            } else {
              const errorText = Array.isArray(res?.errors) ? res.errors.join(', ') : 'Unknown error';
              alert(`Import failed: ${errorText}`);
            }
          },
          (err) => {
            console.error('Import error', err);
            alert(`Import failed: ${err?.error?.error || err.message || 'Server error'}`);
          }
        );
      } catch (err) {
        console.error('CSV parse error', err);
        alert('Failed to parse CSV');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  toggleExportDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.showExportDropdown = !this.showExportDropdown;
  }

  exportData(format: string, scope: 'current' | 'all') {
    const dataRows = scope === 'current' ? this.pagedRows : this.filteredRows;
    this.showExportDropdown = false;
    if (format === 'csv') {
      this.downloadCSV(dataRows);
      return;
    }
    // fallback: generate simple spreadsheet/html for xlsx/ods or pdf
    this.downloadSpreadsheet(dataRows, format === 'xlsx' ? 'xlsx' : 'ods');
  }

  copyNamesToClipboard() {
    this.showExportDropdown = false;
    const names = this.filteredRows.map(r => r['name'] ?? '').filter(Boolean).join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(names).then(() => console.log('copied'));
    } else {
      alert('Clipboard API not available');
    }
  }

  private downloadCSV(data: Record<string, any>[]) {
    const headers = this.columns.map(c => c.label);
    const rows = data.map(row => this.columns.map(c => '"' + String(row[c.key] ?? '').replace(/"/g, '""') + '"'));
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    this.triggerDownload(csv, `${this.assetTitle}.csv`, 'text/csv');
  }

  private downloadSpreadsheet(data: Record<string, any>[], ext: 'xlsx' | 'ods') {
    const headers = this.columns.map(c => c.label);
    const sheetRows = data.map(row => this.columns.map(c => String(row[c.key] ?? '')));
    let html = '<html><head><meta charset="UTF-8"></head><body><table border="1">';
    html += '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
    sheetRows.forEach(r => {
      html += '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>';
    });
    html += '</table></body></html>';
    const mime = ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.oasis.opendocument.spreadsheet';
    this.triggerDownload(html, `${this.assetTitle}.${ext}`, mime);
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

  paginate() {
    this.totalRows = this.filteredRows.length;
    this.totalPages = Math.max(1, Math.ceil(this.totalRows / this.pageSize));
    const start = (this.currentPage - 1) * this.pageSize;
    this.pagedRows = this.filteredRows.slice(start, start + this.pageSize);
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.paginate();
  }

  get pageNumbers(): number[] {
    const pages: number[] = [];
    for (let i = 1; i <= this.totalPages; i++) pages.push(i);
    return pages;
  }

  get showingFrom(): number {
    return this.totalRows === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
  }

  get showingTo(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalRows);
  }
}

