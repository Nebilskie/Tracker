import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItFloorplanPage } from './it-floorplan.page';

describe('ItFloorplanPage', () => {
  let component: ItFloorplanPage;
  let fixture: ComponentFixture<ItFloorplanPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ItFloorplanPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
