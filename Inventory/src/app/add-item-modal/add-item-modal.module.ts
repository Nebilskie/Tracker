import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { AddItemModalPageRoutingModule } from './add-item-modal-routing.module';

import { AddItemModalPage } from './add-item-modal.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AddItemModalPageRoutingModule
  ],
  declarations: [AddItemModalPage]
})
export class AddItemModalPageModule {}
