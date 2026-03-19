import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItInventoryPage } from './it-inventory.page';

describe('ItInventoryPage', () => {
  let component: ItInventoryPage;
  let fixture: ComponentFixture<ItInventoryPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ItInventoryPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
