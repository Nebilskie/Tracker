import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserFloorplanPage } from './user-floorplan.page';

describe('UserFloorplanPage', () => {
  let component: UserFloorplanPage;
  let fixture: ComponentFixture<UserFloorplanPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(UserFloorplanPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
