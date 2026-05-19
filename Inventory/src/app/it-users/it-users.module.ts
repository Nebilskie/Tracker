import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ItUsersPageRoutingModule } from './it-users-routing.module';

import { ItUsersPage } from './it-users.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ItUsersPageRoutingModule
  ],
  declarations: [ItUsersPage]
})
export class ItUsersPageModule {}
