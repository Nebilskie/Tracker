import { Injectable } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
} from '@angular/common/http';
import { Observable, from, switchMap } from 'rxjs';
import { DeviceIdService } from '../services/device-id.service';

@Injectable()
export class DeviceIdInterceptor implements HttpInterceptor {
  constructor(private deviceIdService: DeviceIdService) {}

  intercept(
    req: HttpRequest<any>,
    next: HttpHandler
  ): Observable<HttpEvent<any>> {
    return from(this.deviceIdService.getDeviceId()).pipe(
      switchMap((deviceId) => {
        const cloned = req.clone({
          setHeaders: { 'X-Device-Id': deviceId },
        });
        return next.handle(cloned);
      })
    );
  }
}

