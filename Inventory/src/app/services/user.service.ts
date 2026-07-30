import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface UserRecord {
  [key: string]: any;
  added?: string;
}

export interface UserHistoryEntry {
  id: number;
  from_building_name?: string;
  from_room_name?: string;
  from_cubicle_label?: string;
  to_building_name?: string;
  to_room_name?: string;
  to_cubicle_label?: string;
  transferred_at: string;
  transferred_by_user_id?: number;
  transferred_by_username?: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private apiBase = environment.apiBase;

  constructor(private http: HttpClient) {}

  getUsers(): Observable<{ success: boolean; users: UserRecord[] }> {
    return this.http.get<{ success: boolean; users: UserRecord[] }>(`${this.apiBase}/users`);
  }

  importUsers(csvData: UserRecord[]): Observable<{ success: boolean; imported: number; skipped: number; errors?: string[] }> {
    return this.http.post<{ success: boolean; imported: number; skipped: number; errors?: string[] }>(`${this.apiBase}/users/import`, { csvData });
  }

  assignLocation(userId: number, payload: {
    building_id?: number | null;
    room_id?: number | null;
    cubicle_id?: number | null;
    cubicle_label?: string | null;
    force_reassign?: boolean;
  }): Observable<{ success: boolean; user?: UserRecord; error?: string; code?: string; conflictUser?: { id: number; username: string } }> {
    return this.http.post<{ success: boolean; user?: UserRecord; error?: string; code?: string; conflictUser?: { id: number; username: string } }>(
      `${this.apiBase}/users/${encodeURIComponent(String(userId))}/assign-location`,
      payload
    );
  }

  createUser(payload: {
    username: string;
    password: string;
    email?: string;
    role?: string;
  }): Observable<{ success: boolean; user?: UserRecord; error?: string }> {
    return this.http.post<{ success: boolean; user?: UserRecord; error?: string }>(
      `${this.apiBase}/users`,
      payload
    );
  }

  getUserHistory(userId: number): Observable<{ success: boolean; history: UserHistoryEntry[] }> {
    return this.http.get<{ success: boolean; history: UserHistoryEntry[] }>(`${this.apiBase}/users/${userId}/history`);
  }
}
