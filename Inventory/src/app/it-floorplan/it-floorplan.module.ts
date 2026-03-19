import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ItFloorplanPageRoutingModule } from './it-floorplan-routing.module';

import { ItFloorplanPage } from './it-floorplan.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ItFloorplanPageRoutingModule
  ],
  declarations: [ItFloorplanPage]
})
export class ItFloorplanPageModule {}
