import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type FloorplanLayout = {
  cubicles: any[];
};

@Injectable({ providedIn: 'root' })
export class FloorplanApiService {
  private baseUrl = 'http://localhost:3000';

  constructor(private http: HttpClient) {}

  saveFloorplan(roomId: string, userId: number, layout: FloorplanLayout): Observable<any> {
    return this.http.post(`${this.baseUrl}/floorplans/${roomId}`, { userId, layout });
  }

  loadFloorplan(roomId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/floorplans/${roomId}`);
  }

  listFloorplans(): Observable<any> {
    return this.http.get(`${this.baseUrl}/floorplans`);
  }

  createRoom(roomId: string, userId: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/rooms`, { roomId, userId });
  }
}