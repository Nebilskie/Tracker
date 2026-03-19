import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { UserFloorplanPageRoutingModule } from './user-floorplan-routing.module';

import { UserFloorplanPage } from './user-floorplan.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    UserFloorplanPageRoutingModule
  ],
  declarations: [UserFloorplanPage]
})
export class UserFloorplanPageModule {}
