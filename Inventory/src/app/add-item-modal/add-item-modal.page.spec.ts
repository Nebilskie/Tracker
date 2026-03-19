import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AddItemModalPage } from './add-item-modal.page';

describe('AddItemModalPage', () => {
  let component: AddItemModalPage;
  let fixture: ComponentFixture<AddItemModalPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(AddItemModalPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
