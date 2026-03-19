import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';

const routes: Routes = [
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then((m) => m.HomePageModule),
  },
  {
    path: 'app',
    component: LayoutComponent,
    children: [
      { path: 'it-home', loadChildren: () => import('./it-home/it-home.module').then((m) => m.ItHomePageModule) },
      { path: 'user-home', loadChildren: () => import('./user-home/user-home.module').then((m) => m.UserHomePageModule) },
      {path: 'it-inventory', loadChildren: () => import('./it-inventory/it-inventory.module').then( m => m.ItInventoryPageModule)},
      {path: 'it-floorplan', loadChildren: () => import('./it-floorplan/it-floorplan.module').then( m => m.ItFloorplanPageModule)},
      {path: 'it-request', loadChildren: () => import('./it-request/it-request.module').then( m => m.ItRequestPageModule)},
      {path: 'add-item-modal', loadChildren: () => import('./add-item-modal/add-item-modal.module').then( m => m.AddItemModalPageModule)},
      {path: 'user-floorplan', loadChildren: () => import('./user-floorplan/user-floorplan.module').then( m => m.UserFloorplanPageModule)},
      {path: 'user-request', loadChildren: () => import('./user-request/user-request.module').then( m => m.UserRequestPageModule)},
    ],
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  

];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule {}
