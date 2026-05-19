import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItUsersPage } from './it-users.page';

describe('ItUsersPage', () => {
  let component: ItUsersPage;
  let fixture: ComponentFixture<ItUsersPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ItUsersPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
