/// <reference types="jasmine" />
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { IonicModule } from '@ionic/angular';

import { AddItemModalPage } from './add-item-modal.page';

describe('AddItemModalPage', () => {
  let component: AddItemModalPage;
  let fixture: ComponentFixture<AddItemModalPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AddItemModalPage],
      imports: [IonicModule.forRoot(), HttpClientTestingModule]
    }).compileComponents();

    fixture = TestBed.createComponent(AddItemModalPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
