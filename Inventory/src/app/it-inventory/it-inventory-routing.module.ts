import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { ItInventoryPage } from './it-inventory.page';

const routes: Routes = [
  {
    path: '',
    component: ItInventoryPage
  },
  {
    path: ':assetType',
    component: ItInventoryPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ItInventoryPageRoutingModule {}
