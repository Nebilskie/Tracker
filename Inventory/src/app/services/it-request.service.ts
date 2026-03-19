import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface ITRequest {
  id?: number;
  username: string;
  requestText: string;
  status: 'new' | 'inprogress' | 'completed' | 'rejected';
  createdAt?: string;
  inprogressAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  rejectedFrom?: 'new' | 'inprogress' | null;
}

@Injectable({
  providedIn: 'root'
})
export class ItRequestService {
  private apiUrl = 'http://localhost:3000/api/it-requests';

  constructor(private http: HttpClient) {}

  /**
   * Create a new IT request
   * @param userId - The ID of the user creating the request
   * @param username - The username of the creator
   * @param requestText - The request description/text
   * @param reason - Optional reason for the request
   */
  createRequest(userId: number, username: string, requestText: string, reason: string = ''): Observable<any> {
    const payload = {
      userId: userId || 1,
      username: username || 'Anonymous',
      requestText,
      reason
    };
    console.log('Sending request with payload:', payload);
    return this.http.post<any>(this.apiUrl, payload).pipe(
      tap((response) => {
        console.log('Request created successfully:', response);
      }),
      catchError((error) => {
        console.error('Error creating request - Full error:', error);
        console.error('Error status:', error.status);
        console.error('Error message:', error.message);
        console.error('Error response:', error.error);
        return of({ success: false, error: error });
      })
    );
  }

  /**
   * Get all IT requests from all status tables
   */
  getAllRequests(): Observable<any> {
    return this.http.get<any>(this.apiUrl).pipe(
      tap((response) => {
        console.log('Requests loaded:', response);
      }),
      catchError((error) => {
        console.error('Error fetching requests:', error);
        return of({ success: false, requests: [], error });
      })
    );
  }

  /**
   * Update the status of an IT request
   * @param requestId - The ID of the request to update
   * @param newStatus - The new status (new, inprogress, completed, rejected)
   */
  updateRequestStatus(requestId: number, newStatus: string): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/${requestId}`, { 
      status: newStatus
    }).pipe(
      tap((response) => {
        console.log('Request status updated:', response);
      }),
      catchError((error) => {
        console.error('Error updating request status:', error);
        return of({ success: false, error });
      })
    );
  }
}
