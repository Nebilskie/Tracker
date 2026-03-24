import { Component, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { InventoryService, InventoryItem, InventorySummaryItem } from '../services/inventory.service';

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
  assetTitle = '';
  columns: ColumnDef[] = [];
  rows: Record<string, any>[] = [];
  filteredRows: Record<string, any>[] = [];
  pagedRows: Record<string, any>[] = [];

  // Pagination
  pageSize = 20;
  currentPage = 1;
  totalRows = 0;
  totalPages = 0;

  // Search
  searchTerm = '';

  // Export dropdown
  showExportDropdown = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private inventoryService: InventoryService
  ) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    // Close dropdown when clicking outside
    const target = event.target as HTMLElement;
    if (!target.closest('.export-wrapper')) {
      this.showExportDropdown = false;
    }
  }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.assetType = params.get('assetType') || '';
      this.loadAssetData();
    });
  }

  goBack() {
    this.router.navigate(['/app/it-inventory']);
  }

  selectAssetType(type: string) {
    this.router.navigate(['/app/it-inventory', type]);
  }

  loadAssetDataManual() {
    this.loadAssetData();
  }

  onSearch() {
    const term = this.searchTerm.toLowerCase().trim();

    if (!term) {
      if (!this.assetType) {
        this.showSummaryView();
      } else {
        this.filteredRows = [...this.rows];
      }
      this.currentPage = 1;
      this.paginate();
      return;
    }

    if (!this.assetType) {
      this.performAllInventoryItemSearch(term);
      return;
    }

    this.filteredRows = this.rows.filter(row =>
      this.getSearchableFields().some(field =>
        String(row[field] ?? '').toLowerCase().includes(term)
      )
    );

    this.currentPage = 1;
    this.paginate();
  }

  private getSearchableFields(): string[] {
    if (!this.assetType) return ['name'];

    if (this.assetType === 'computers') {
      return ['name', 'status', 'manufacturer', 'serial_number', 'type', 'model', 'os', 'location', 'processor'];
    } else {
      return ['name', 'status', 'manufacturer', 'location', 'model'];
    }
  }

  private showSummaryView() {
    this.assetTitle = 'All Inventory';
    this.columns = [
      { key: 'name', label: 'ITEM' },
      { key: 'total', label: 'TOTAL' },
      { key: 'defects', label: 'DEFECTS' },
      { key: 'used', label: 'USED' },
      { key: 'available', label: 'AVAILABLE' }
    ];

    this.inventoryService.getSummary().subscribe(response => {
      if (response?.success) {
        this.rows = response.summary;
        this.filteredRows = [...this.rows];
        this.currentPage = 1;
        this.paginate();
      }
    });
  }

  private performAllInventoryItemSearch(term: string) {
    const inventoryTypes = ['computers', 'monitors', 'headsets', 'mouse', 'keyboards', 'cameras'];

    const requests = inventoryTypes.map(type => this.inventoryService.getItems(type));

    forkJoin(requests).subscribe(results => {
      const allItems: any[] = [];

      results.forEach((res, idx) => {
        const type = inventoryTypes[idx];
        if (res?.success && Array.isArray(res.items)) {
          res.items.forEach(item => {
            allItems.push({ ...item, inventoryType: type });
          });
        }
      });

      this.columns = [
        { key: 'inventoryType', label: 'TYPE' },
        { key: 'name', label: 'NAME' },
        { key: 'status', label: 'STATUS' },
        { key: 'manufacturer', label: 'MANUFACTURER' },
        { key: 'serial_number', label: 'SERIAL NUMBER' },
        { key: 'type', label: 'KIND' },
        { key: 'model', label: 'MODEL' },
        { key: 'os', label: 'OPERATING SYSTEM' },
        { key: 'location', label: 'LOCATION' },
        { key: 'processor', label: 'PROCESSOR' },
        { key: 'last_update', label: 'LAST UPDATE' }
      ];

      this.rows = allItems;

      const searchableFields = ['inventoryType', 'name', 'status', 'manufacturer', 'serial_number', 'type', 'model', 'os', 'location', 'processor', 'last_update'];

      this.filteredRows = this.rows.filter(row =>
        searchableFields.some(field =>
          String(row[field] ?? '').toLowerCase().includes(term)
        )
      );

      this.currentPage = 1;
      this.paginate();
    });
  }

  paginate() {
    this.totalRows = this.filteredRows.length;
    this.totalPages = Math.ceil(this.totalRows / this.pageSize) || 1;
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

  // ---- Import ----
  onImportFile(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      try {
        const csvData = this.parseCSV(text);
        if (csvData.length === 0) {
          alert('No data found in CSV file');
          return;
        }

        // Check if this is bulk import (has type column) or single type import
        const hasTypeColumn = csvData.length > 0 && csvData[0].hasOwnProperty('type');

        if (hasTypeColumn) {
          // Bulk import - validate that all rows have type
          const validation = this.validateBulkCSVData(csvData);
          if (!validation.valid) {
            alert(`CSV validation failed:\n${validation.errors.join('\n')}`);
            return;
          }

          // Confirm import
          if (!confirm(`Bulk import ${csvData.length} items across multiple inventory types? Existing items with the same name will be skipped.`)) {
            return;
          }

          // Send to bulk import endpoint
          this.inventoryService.importBulkItems(csvData).subscribe({
            next: (response) => {
              if (response.success) {
                alert(`Bulk import completed!\nImported: ${response.imported}\nSkipped: ${response.skipped}`);
                if (response.errors && response.errors.length > 0) {
                  console.warn('Import errors:', response.errors);
                }
                // Reload data if a type is currently selected
                if (this.assetType) {
                  this.loadAssetData();
                }
              } else {
                alert('Import failed: ' + (response.errors?.join(', ') || 'Unknown error'));
              }
            },
            error: (err) => {
              console.error('Import error:', err);
              alert('Import failed. Please check the console for details.');
            }
          });
        } else {
          // Single type import - requires type selection
          if (!this.assetType) {
            alert('Please select an inventory type first for single-type import (Computers, Monitors, etc.)');
            event.target.value = '';
            return;
          }

          // Validate CSV data for single type
          const validation = this.validateCSVData(csvData, this.assetType);
          if (!validation.valid) {
            alert(`CSV validation failed:\n${validation.errors.join('\n')}`);
            return;
          }

          // Confirm import
          if (!confirm(`Import ${csvData.length} items into ${this.assetType}? Existing items with the same name will be skipped.`)) {
            return;
          }

          // Send to backend
          this.inventoryService.importItems(this.assetType, csvData).subscribe({
            next: (response) => {
              if (response.success) {
                alert(`Import completed!\nImported: ${response.imported}\nSkipped: ${response.skipped}`);
                if (response.errors && response.errors.length > 0) {
                  console.warn('Import errors:', response.errors);
                }
                // Reload data
                this.loadAssetData();
              } else {
                alert('Import failed: ' + (response.errors?.join(', ') || 'Unknown error'));
              }
            },
            error: (err) => {
              console.error('Import error:', err);
              alert('Import failed. Please check the console for details.');
            }
          });
        }

      } catch (error) {
        console.error('CSV parsing error:', error);
        alert('Failed to parse CSV file. Please check the format.');
      }
    };

    reader.readAsText(file);
    event.target.value = ''; // reset so same file can be re-selected
  }

  private parseCSV(text: string): any[] {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const rows = lines.slice(1);

    return rows.map(row => {
      const values = this.parseCSVRow(row);
      const obj: any = {};

      headers.forEach((header, index) => {
        const value = values[index] || '';
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
      const char = row[i];

      if (char === '"') {
        if (inQuotes && row[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current); // Add last field
    return result;
  }

  private validateCSVData(csvData: any[], assetType: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (csvData.length === 0) {
      errors.push('No data rows found');
      return { valid: false, errors };
    }

    csvData.forEach((row, index) => {
      const rowNum = index + 1;

      // Check required fields
      if (!row.name || typeof row.name !== 'string' || !row.name.trim()) {
        errors.push(`Row ${rowNum}: Missing or invalid 'name' field`);
      }

      // Type-specific validation
      if (assetType === 'computers') {
        // Computers have more fields, but they're all optional except name
      } else {
        // Other types have basic validation
      }
    });

    return { valid: errors.length === 0, errors };
  }

  private validateBulkCSVData(csvData: any[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const validTypes = ['computers', 'monitors', 'headsets', 'mouse', 'keyboards', 'cameras'];

    if (csvData.length === 0) {
      errors.push('No data rows found');
      return { valid: false, errors };
    }

    csvData.forEach((row, index) => {
      const rowNum = index + 1;

      // Check required fields
      if (!row.name || typeof row.name !== 'string' || !row.name.trim()) {
        errors.push(`Row ${rowNum}: Missing or invalid 'name' field`);
      }

      if (!row.type || typeof row.type !== 'string' || !row.type.trim()) {
        errors.push(`Row ${rowNum}: Missing or invalid 'type' field`);
      } else {
        const type = row.type.trim().toLowerCase();
        if (!validTypes.includes(type)) {
          errors.push(`Row ${rowNum}: Invalid type '${row.type}'. Must be one of: ${validTypes.join(', ')}`);
        }
      }
    });

    return { valid: errors.length === 0, errors };
  }

  // ---- Export dropdown ----
  toggleExportDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.showExportDropdown = !this.showExportDropdown;
  }

  exportData(format: string, scope: 'current' | 'all') {
    const dataRows = scope === 'current' ? this.pagedRows : this.filteredRows;
    this.showExportDropdown = false;

    switch (format) {
      case 'csv':
        this.downloadCSV(dataRows);
        break;
      case 'xlsx':
        this.downloadSpreadsheet(dataRows, 'xlsx');
        break;
      case 'ods':
        this.downloadSpreadsheet(dataRows, 'ods');
        break;
      case 'pdf-landscape':
        this.downloadPDF(dataRows, 'landscape');
        break;
      case 'pdf-portrait':
        this.downloadPDF(dataRows, 'portrait');
        break;
    }
  }

  copyNamesToClipboard() {
    this.showExportDropdown = false;
    const names = this.filteredRows.map(r => r['name'] ?? '').filter(Boolean).join('\n');
    navigator.clipboard.writeText(names).then(() => {
      console.log('Names copied to clipboard');
    });
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
    // Build a simple HTML table that Excel/LibreOffice can open
    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="UTF-8"></head><body><table border="1">';
    html += '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
    sheetRows.forEach(r => {
      html += '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>';
    });
    html += '</table></body></html>';
    const mime = ext === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.oasis.opendocument.spreadsheet';
    this.triggerDownload(html, `${this.assetTitle}.${ext}`, mime);
  }

  private downloadPDF(data: Record<string, any>[], orientation: 'landscape' | 'portrait') {
    const headers = this.columns.map(c => c.label);
    const bodyRows = data.map(row => this.columns.map(c => String(row[c.key] ?? '')));
    const pageStyle = orientation === 'landscape' ? '@page { size: landscape; }' : '@page { size: portrait; }';
    let html = `<html><head><meta charset="UTF-8"><style>
      ${pageStyle}
      body { font-family: Arial, sans-serif; font-size: 11px; }
      h2 { margin-bottom: 8px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; }
      th { background: #3b4998; color: #fff; font-size: 10px; }
    </style></head><body>`;
    html += `<h2>${this.assetTitle}</h2><table>`;
    html += '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
    bodyRows.forEach(r => {
      html += '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>';
    });
    html += '</table></body></html>';
    const printWin = window.open('', '_blank', 'width=900,height=700');
    if (printWin) {
      printWin.document.write(html);
      printWin.document.close();
      printWin.focus();
      printWin.print();
    }
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

  private loadAssetData() {
    if (!this.assetType) {
      this.assetTitle = 'All Inventory';
      this.columns = [
        { key: 'name', label: 'ITEM' },
        { key: 'total', label: 'TOTAL' },
        { key: 'defects', label: 'DEFECTS' },
        { key: 'used', label: 'USED' },
        { key: 'available', label: 'AVAILABLE' }
      ];
      this.inventoryService.getSummary().subscribe(response => {
        if (response?.success) {
          this.rows = response.summary;
          this.filteredRows = [...this.rows];
          this.currentPage = 1;
          this.paginate();
        }
      });
      return;
    }

    const isComputers = this.assetType === 'computers';

    this.inventoryService.getItems(this.assetType).subscribe(response => {
      if (!response?.success) return;

      this.rows = response.items;
      this.assetTitle = this.assetType.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      if (isComputers) {
        this.columns = [
          { key: 'name', label: 'NAME' },
          { key: 'status', label: 'STATUS' },
          { key: 'manufacturer', label: 'MANUFACTURER' },
          { key: 'serial_number', label: 'SERIAL NUMBER' },
          { key: 'type', label: 'TYPE' },
          { key: 'model', label: 'MODEL' },
          { key: 'os', label: 'OPERATING SYSTEM' },
          { key: 'location', label: 'LOCATION' },
          { key: 'last_update', label: 'LAST UPDATE' },
          { key: 'processor', label: 'COMPONENTS - PROCESSOR' }
        ];
      } else {
        this.columns = [
          { key: 'name', label: 'NAME' },
          { key: 'status', label: 'STATUS' },
          { key: 'manufacturer', label: 'MANUFACTURER' },
          { key: 'location', label: 'LOCATION' },
          { key: 'model', label: 'MODEL' },
          { key: 'last_update', label: 'LAST UPDATE' }
        ];
      }

      this.filteredRows = [...this.rows];
      this.currentPage = 1;
      this.paginate();
    });
  }

  private getComputersConfig() {
    return {
      title: 'Computers',
      columns: [
        { key: 'name', label: 'NAME' },
        { key: 'status', label: 'STATUS' },
        { key: 'manufacturer', label: 'MANUFACTURER' },
        { key: 'serialNumber', label: 'SERIAL NUMBER' },
        { key: 'type', label: 'TYPE' },
        { key: 'model', label: 'MODEL' },
        { key: 'os', label: 'OPERATING SYSTEM' },
        { key: 'location', label: 'LOCATION' },
        { key: 'lastUpdate', label: 'LAST UPDATE' },
        { key: 'processor', label: 'COMPONENTS - PROCESSOR' },
      ],
      rows: [
        { name: 'DESKTOP-A50MP1M', status: '', manufacturer: 'HP', serialNumber: '8OC9232YNK', type: 'Mini Tower', model: 'HP ProDesk 600 G4 DM', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 20:00', processor: 'Intel Core i5-8500T CPU @ 2.10GHz' },
        { name: 'HBPC00176-HP',  status: '', manufacturer: 'HP', serialNumber: 'SGH817RGV7', type: 'Desktop', model: 'HP ProDesk 600 G3 SFF', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 13:56', processor: 'Intel Core i5-6500 CPU @ 3.20GHz' },
        { name: 'HBPC00104-HP',  status: '', manufacturer: 'HP', serialNumber: 'SGH822TNDY', type: 'Desktop', model: 'HP ProDesk 600 G3 SFF', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 17:30', processor: 'Intel Core i5-6500 CPU @ 3.20GHz' },
        { name: 'HBPC052-NEC',  status: '', manufacturer: 'NEC', serialNumber: '56O13131A', type: 'Desktop', model: 'PC-MK33MBZEK', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 12:47', processor: 'Intel Core i5-4590 CPU @ 3.30GHz' },
        { name: 'HBPC0067-HPPRO', status: '', manufacturer: 'Dell Inc.', serialNumber: 'GZZKG52', type: 'Space-Saving', model: 'OptiPlex 3020', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 12:44', processor: 'Intel Core i3-4160 CPU @ 3.60GHz' },
        { name: 'HBPC000107-HPPRO',  status: '', manufacturer: 'HP', serialNumber: 'SGH817RHDT', type: 'Desktop', model: 'HP ProDesk 600 G3 SFF', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 13:47', processor: 'Intel Core i5-6500 CPU @ 3.20GHz' },
        { name: 'HBPC0001-DELL',  status: '', manufacturer: 'Dell Inc.', serialNumber: '1N9YZG2', type: 'Desktop', model: 'OptiPlex 5040', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 12:55', processor: 'Intel Core i5-6500 CPU @ 3.20GHz' },
        { name: 'HBPC0048-DELL', status: '', manufacturer: 'Dell Inc.', serialNumber: '78V50J2', type: 'Desktop', model: 'OptiPlex 3040', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 13:35', processor: 'Intel Core i5-6500 CPU @ 3.20GHz' },
        { name: 'HBPC0028-DELL-2', status: '', manufacturer: 'Dell Inc.', serialNumber: '4M8J102', type: 'Space-Saving', model: 'OptiPlex 3020', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 14:06', processor: 'Intel Core i5-4590 CPU @ 3.30GHz' },
        { name: 'HBPC066-DELL', status: '', manufacturer: 'HP', serialNumber: 'SGH817RGRF', type: 'Desktop', model: 'HP ProDesk 600 G3 SFF', os: 'Microsoft Windows 10 Pro', location: '', lastUpdate: '02-17-2026 16:21', processor: 'Intel Core i5-6500 CPU @ 3.20GHz' },
      ]
    };
  }

  private getMonitorsConfig() {
    return {
      title: 'Monitors',
      columns: [
        { key: 'name', label: 'NAME' },
        { key: 'status', label: 'STATUS' },
        { key: 'manufacturer', label: 'MANUFACTURER' },
        { key: 'location', label: 'LOCATION' },
        { key: 'model', label: 'MODEL' },
        { key: 'lastUpdate', label: 'LAST UPDATE' },
      ],
      rows: [
        { name: 'HP ZR2440w', status: '', manufacturer: 'Hewlett Packard', location: '', type: '', model: 'HP ZR2440w', lastUpdate: '01-28-2026 19:40', alternateUsername: 'Admin@DESKTOP-A50MP1M' },
        { name: 'DELL U2412M', status: '', manufacturer: 'Dell Inc.', location: '', type: '', model: 'DELL U2412M', lastUpdate: '01-31-2026 03:00', alternateUsername: 'Admin@DESKTOP-A50MP1M' },
        { name: 'N200HDV8', status: '', manufacturer: 'IPS, Inc. (Intellectual Property Solutions, Inc.)', location: '', type: '', model: 'N200HDV8', lastUpdate: '02-17-2026 13:58', alternateUsername: 'rtleo@HIREBIZ' },
        { name: 'DELL P1911', status: '', manufacturer: 'Dell Inc.', location: '', type: '', model: 'DELL P1911', lastUpdate: '02-16-2026 12:57', alternateUsername: 'Mgumba@HIREBIZ' },
        { name: 'HP P223', status: '', manufacturer: 'HPN', location: '', type: '', model: 'HP P223', lastUpdate: '02-16-2026 14:08', alternateUsername: 'csumalinoo@HIREBIZ/Admin@HBPC0027-DEL' },
        { name: 'LT1952p Wide', status: '', manufacturer: 'Lenovo Group Limited', location: '', type: '', model: 'LT1952p Wide', lastUpdate: '02-16-2026 15:59', alternateUsername: 'ACayanong@HIREBIZ' },
        { name: 'DELL P2214H', status: '', manufacturer: 'Dell Inc.', location: '', type: '', model: 'DELL P2214H', lastUpdate: '02-10-2026 15:58', alternateUsername: 'DTaboada@HIREBIZ' },
        { name: 'DELL 1909W', status: '', manufacturer: 'Dell Inc.', location: '', type: '', model: 'DELL 1909W', lastUpdate: '02-17-2028 15:53', alternateUsername: 'Overidge@HIREBIZ' },
      ]
    };
  }

  private getSoftwareConfig() {
    return {
      title: 'Software',
      columns: [
        { key: 'name', label: 'NAME' },
        { key: 'entity', label: 'ENTITY' },
        { key: 'publisher', label: 'PUBLISHER' },
        { key: 'versionsName', label: 'VERSIONS - NAME' },
        { key: 'versionsOs', label: 'VERSIONS - OPERATING SYSTEM' },
        { key: 'installations', label: 'NUMBER OF INSTALLATIONS' },
        { key: 'licenses', label: 'LICENSES - NUMBER OF LICENSES' },
      ],
      rows: [
        { name: 'CPUID CPU-Z 2.18', entity: 'Root Entity', publisher: 'CPUID, Inc.', versionsName: '2.18', versionsOs: 'Microsoft Windows 10 Pro', installations: 2, licenses: '' },
        { name: 'Mozilla Thunderbird (x64 en-US)', entity: 'Root Entity', publisher: 'Mozilla', versionsName: '147.0, 141.0, 147.0.1, 141.0, 115.12.2', versionsOs: 'Microsoft Windows 10 Pro, Microsoft Windows 10 Pro for Workstations, Windows', installations: 93, licenses: '' },
        { name: 'Mozilla Maintenance Service', entity: 'Root Entity', publisher: 'Mozilla', versionsName: '147.0, 136.0.4, 143.0.4, 141.0, 145.0.2', versionsOs: 'Microsoft Windows 10 Pro, Microsoft Windows 10 Pro for Workstations, Windows', installations: 99, licenses: '' },
        { name: 'Microsoft 365 Apps for enterprise - en-us', entity: 'Root Entity', publisher: 'Microsoft Corporation', versionsName: '16.0.19530.20184', versionsOs: 'Microsoft Windows 10 Pro, Microsoft Windows 10 Pro for Workstations, Windows', installations: 32, licenses: '' },
        { name: 'Microsoft OneDrive', entity: 'Root Entity', publisher: 'Microsoft Corporation', versionsName: '25.243.1211.0001', versionsOs: 'Microsoft Windows 10 Pro, Microsoft Windows 10 Pro for', installations: 35, licenses: '' },
      ]
    };
  }

  private getHeadsetsConfig() {
    return {
      title: 'Headsets',
      columns: [
        { key: 'name', label: 'NAME' },
        { key: 'status', label: 'STATUS' },
        { key: 'manufacturer', label: 'MANUFACTURER' },
        { key: 'location', label: 'LOCATION' },
        { key: 'model', label: 'MODEL' },
        { key: 'lastUpdate', label: 'LAST UPDATE' },
      ],
      rows: [
        { name: 'HS001', entity: 'Root Entity', status: '', manufacturer: 'Logitech', model: 'H390', location: '', lastUpdate: '02-15-2026 10:30' },
        { name: 'HS002', entity: 'Root Entity', status: '', manufacturer: 'Plantronics', model: 'Voyager 5200', location: '', lastUpdate: '02-14-2026 14:20' },
        { name: 'HS003', entity: 'Root Entity', status: '', manufacturer: 'CORSAIR', model: 'HS70', location: '', lastUpdate: '02-13-2026 09:15' },
      ]
    };
  }

  private getMouseConfig() {
    return {
      title: 'Mouse',
      columns: [
        { key: 'name', label: 'NAME' },
        { key: 'status', label: 'STATUS' },
        { key: 'manufacturer', label: 'MANUFACTURER' },
        { key: 'location', label: 'LOCATION' },
        { key: 'model', label: 'MODEL' },
        { key: 'lastUpdate', label: 'LAST UPDATE' },
      ],
      rows: [
        { name: 'MS001', entity: 'Root Entity', status: '', manufacturer: 'Logitech', model: 'M705', type: 'Wireless', location: '', lastUpdate: '02-16-2026 11:45' },
        { name: 'MS002', entity: 'Root Entity', status: '', manufacturer: 'Razer', model: 'DeathAdder V3', type: 'Wired', location: '', lastUpdate: '02-15-2026 13:20' },
        { name: 'MS003', entity: 'Root Entity', status: '', manufacturer: 'Microsoft', model: 'Sculpt Comfort', type: 'Wireless', location: '', lastUpdate: '02-14-2026 15:00' },
      ]
    };
  }

  private getKeyboardsConfig() {
    return {
      title: 'Keyboards',
      columns: [
        { key: 'name', label: 'NAME' },
        { key: 'status', label: 'STATUS' },
        { key: 'manufacturer', label: 'MANUFACTURER' },
        { key: 'location', label: 'LOCATION' },
        { key: 'model', label: 'MODEL' },
        { key: 'lastUpdate', label: 'LAST UPDATE' },
      ],
      rows: [
        { name: 'KB001', entity: 'Root Entity', status: '', manufacturer: 'Logitech', model: 'K380', type: 'Wireless', location: '', lastUpdate: '02-16-2026 10:10' },
        { name: 'KB002', entity: 'Root Entity', status: '', manufacturer: 'Corsair', model: 'K95 Platinum', type: 'Wired', location: '', lastUpdate: '02-15-2026 12:30' },
        { name: 'KB003', entity: 'Root Entity', status: '', manufacturer: 'Microsoft', model: 'Ergonomic Keyboard', type: 'Wired', location: '', lastUpdate: '02-14-2026 14:45' },
      ]
    };
  }



 
}

