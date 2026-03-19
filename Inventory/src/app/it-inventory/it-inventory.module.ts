import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { ItInventoryPageRoutingModule } from './it-inventory-routing.module';

import { ItInventoryPage } from './it-inventory.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    BaseChartDirective,
    ItInventoryPageRoutingModule
  ],
  declarations: [ItInventoryPage],
  providers: [provideCharts(withDefaultRegisterables())]
})
export class ItInventoryPageModule {}
