import { TestBed } from '@angular/core/testing';

import { FloorplanApiService } from './floorplan-api';

describe('FloorplanApi', () => {
  let service: FloorplanApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FloorplanApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
