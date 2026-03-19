import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { ItFloorplanPage } from './it-floorplan.page';

const routes: Routes = [
  {
    path: '',
    component: ItFloorplanPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ItFloorplanPageRoutingModule {}
