import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { UserFloorplanPage } from './user-floorplan.page';

const routes: Routes = [
  {
    path: '',
    component: UserFloorplanPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserFloorplanPageRoutingModule {}
