import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItHomePage } from './it-home.page';

describe('ItHomePage', () => {
  let component: ItHomePage;
  let fixture: ComponentFixture<ItHomePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ItHomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
