import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface UserRecord {
  [key: string]: any;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private apiBase = 'http://localhost:3000/api';

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
  }): Observable<{ success: boolean; user?: UserRecord; error?: string }> {
    return this.http.post<{ success: boolean; user?: UserRecord; error?: string }>(
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
}
