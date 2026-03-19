import { TestBed } from '@angular/core/testing';

import { FloorplanApi } from './floorplan-api';

describe('FloorplanApi', () => {
  let service: FloorplanApi;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FloorplanApi);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
