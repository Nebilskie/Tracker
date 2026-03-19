import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserRequestPage } from './user-request.page';

describe('UserRequestPage', () => {
  let component: UserRequestPage;
  let fixture: ComponentFixture<UserRequestPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(UserRequestPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
