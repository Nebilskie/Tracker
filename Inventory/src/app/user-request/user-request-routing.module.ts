import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { UserRequestPage } from './user-request.page';

const routes: Routes = [
  {
    path: '',
    component: UserRequestPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserRequestPageRoutingModule {}
