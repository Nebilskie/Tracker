import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface InventoryItem {
  id?: number;
  code?: string;
  item_type?: string;
  item_details?: string;
  name?: string;
  status?: string | number;
  manufacturer?: string;
  location?: string;
  cubicle_label?: string;
  room_name?: string;
  building_name?: string;
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
  pending: number;
}

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private apiBase = environment.apiBase;

  constructor(private http: HttpClient) {}

  getSummary(): Observable<{ success: boolean; summary: InventorySummaryItem[] }> {
    return this.http.get<{ success: boolean; summary: InventorySummaryItem[] }>(`${this.apiBase}/inventory/summary`);
  }

  getItems(type: string, availableOnly: boolean = false, requestId?: number): Observable<{ success: boolean; items: InventoryItem[] }> {
    const params = new URLSearchParams();
    if (availableOnly) {
      params.set('availableOnly', '1');
    }
    if (requestId != null) {
      params.set('requestId', String(requestId));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<{ success: boolean; items: InventoryItem[] }>(`${this.apiBase}/inventory/${encodeURIComponent(type)}${query}`);
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

  updateItemStatus(itemId: number, status: string, location?: { building_id?: number; room_id?: number; cubicle_id?: number }): Observable<{ success: boolean; status: number }> {
    const payload: any = { status };
    if (location) {
      Object.assign(payload, location);
    }
    return this.http.put<{ success: boolean; status: number }>(`${this.apiBase}/items/${itemId}/status`, payload);
  }

  getAllItems(): Observable<{ success: boolean; items: any[] }> {
    return this.http.get<{ success: boolean; items: any[] }>(`${this.apiBase}/items`);
  }

  getBrands(): Observable<{ success: boolean; brands: any[] }> {
    return this.http.get<{ success: boolean; brands: any[] }>(`${this.apiBase}/brands`);
  }

  createItem(payload: any): Observable<{ success: boolean; id?: number; error?: string }> {
    return this.http.post<{ success: boolean; id?: number; error?: string }>(`${this.apiBase}/items`, payload);
  }

  getItemsByCubicle(cubicleLabel: string): Observable<{ success: boolean; items: InventoryItem[] }> {
    return new Observable(observer => {
      this.getAllItems().subscribe(
        (response) => {
          if (response.success && Array.isArray(response.items)) {
            const filteredItems = response.items.filter(
              item => item.cubicle_label === cubicleLabel
            );
            observer.next({ success: true, items: filteredItems });
          } else {
            observer.next({ success: false, items: [] });
          }
          observer.complete();
        },
        (error) => {
          observer.error(error);
        }
      );
    });
  }
}
