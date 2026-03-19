import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { AddItemModalPage } from './add-item-modal.page';

const routes: Routes = [
  {
    path: '',
    component: AddItemModalPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AddItemModalPageRoutingModule {}
