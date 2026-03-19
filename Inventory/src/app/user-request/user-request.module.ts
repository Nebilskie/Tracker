import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { UserRequestPageRoutingModule } from './user-request-routing.module';

import { UserRequestPage } from './user-request.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    UserRequestPageRoutingModule
  ],
  declarations: [UserRequestPage]
})
export class UserRequestPageModule {}
