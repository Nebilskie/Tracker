import { Injectable } from '@angular/core';
import { interval, startWith, Subscription } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AutoRefreshService {
  watch(refresh: () => void | Promise<void>, intervalMs = 5000): Subscription {
    return interval(intervalMs)
      .pipe(startWith(0))
      .subscribe(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          return;
        }

        void refresh();
      });
  }
}