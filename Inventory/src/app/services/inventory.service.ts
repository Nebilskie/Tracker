import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface InventoryItem {
  id?: number;
  name?: string;
  status?: string | number;
  manufacturer?: string;
  location?: string;
  model?: string;
  last_update?: string;
  serial_number?: string;
  type?: string;
  os?: string;
  processor?: string;
}

export interface InventorySummaryItem {
  name: string;
  total: number;
  defects: number;
  available: number;
  used: number;
}

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private apiBase = 'http://localhost:3000/api';

  constructor(private http: HttpClient) {}

  getSummary(): Observable<{ success: boolean; summary: InventorySummaryItem[] }> {
    return this.http.get<{ success: boolean; summary: InventorySummaryItem[] }>(`${this.apiBase}/inventory/summary`);
  }

  getItems(type: string): Observable<{ success: boolean; items: InventoryItem[] }> {
    return this.http.get<{ success: boolean; items: InventoryItem[] }>(`${this.apiBase}/inventory/${encodeURIComponent(type)}`);
  }

  importItems(type: string, csvData: any[]): Observable<{ success: boolean; imported: number; skipped: number; errors?: string[] }> {
    return this.http.post<{ success: boolean; imported: number; skipped: number; errors?: string[] }>(`${this.apiBase}/inventory/${encodeURIComponent(type)}/import`, { csvData });
  }

  importBulkItems(csvData: any[]): Observable<{ success: boolean; imported: number; skipped: number; errors?: string[] }> {
    return this.http.post<{ success: boolean; imported: number; skipped: number; errors?: string[] }>(`${this.apiBase}/inventory/import`, { csvData });
  }

  importMstItems(csvData: any[]): Observable<{ success: boolean; imported: number; skipped: number; errors?: string[] }> {
    return this.http.post<{ success: boolean; imported: number; skipped: number; errors?: string[] }>(`${this.apiBase}/items/import`, { csvData });
  }

  getItemTypes(): Observable<{ success: boolean; types: string[] }> {
    return this.http.get<{ success: boolean; types: string[] }>(`${this.apiBase}/items/types`);
  }

  getAllItems(): Observable<{ success: boolean; items: any[] }> {
    return this.http.get<{ success: boolean; items: any[] }>(`${this.apiBase}/items`);
  }
}
