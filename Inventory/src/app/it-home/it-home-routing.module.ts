import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { ItHomePage } from './it-home.page';

const routes: Routes = [
  {
    path: '',
    component: ItHomePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ItHomePageRoutingModule {}
