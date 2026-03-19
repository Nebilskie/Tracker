import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItRequestPage } from './it-request.page';

describe('ItRequestPage', () => {
  let component: ItRequestPage;
  let fixture: ComponentFixture<ItRequestPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ItRequestPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
