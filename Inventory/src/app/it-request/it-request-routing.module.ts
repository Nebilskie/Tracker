import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { ItRequestPage } from './it-request.page';

const routes: Routes = [
  {
    path: '',
    component: ItRequestPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ItRequestPageRoutingModule {}
