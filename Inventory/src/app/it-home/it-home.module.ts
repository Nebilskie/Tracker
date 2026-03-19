import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { ItHomePageRoutingModule } from './it-home-routing.module';

import { ItHomePage } from './it-home.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    BaseChartDirective,
    ItHomePageRoutingModule
  ],
  declarations: [ItHomePage],
  providers: [provideCharts(withDefaultRegisterables())]
})
export class ItHomePageModule {}
