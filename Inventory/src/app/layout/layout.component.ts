import { Component, OnInit, ChangeDetectorRef, Renderer2, OnDestroy } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { UserService } from '../services/user.service';

interface Language {
  code: string;
  label: string;
}

@Component({
  selector: 'app-layout',
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, RouterModule],
})
export class LayoutComponent implements OnInit, OnDestroy {
  userName: string = 'User';
  userRole: string = 'User';
  userLocation: string = 'Not assigned';
  isUser: boolean = false;
  isUserMenuOpen: boolean = false;
  isDarkMode: boolean = false;

  private routerSubscription: any;

  // Language settings
  showLanguageDropdown: boolean = false;
  currentLanguage: string = 'en';
  languages: Language[] = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'ja', label: '日本語' },
  ];

  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef,
    private renderer: Renderer2,
    private userService: UserService
  ) {}

  ngOnInit() {
    this.loadUserName();
    this.loadUserRole();
    this.loadAssignedLocation();

    // Load and apply dark mode from localStorage
    this.isDarkMode = localStorage.getItem('darkMode') === 'true';
    this.applyDarkMode(this.isDarkMode);

    // Load saved language preference
    this.currentLanguage = localStorage.getItem('language') || 'en';

    // Update user info & sidebar whenever navigation happens (so role changes take effect immediately)
    this.routerSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.isUserMenuOpen = false;
        this.showLanguageDropdown = false;

        // Refresh user info/role on every navigation so the sidebar matches the current session user
        this.loadUserName();
        this.loadUserRole();
        this.loadAssignedLocation();
      }
    });

    this.cdr.detectChanges();
  }

  loadUserName() {
    const user = this.getStoredUser();
    if (user) {
      try {
        this.userName = user.username || user.name || 'User';
      } catch (error) {
        console.error('Error parsing user data:', error);
        this.userName = 'User';
      }
    } else {
      this.userName = 'User';
    }
  }

  loadUserRole() {
    const user = this.getStoredUser();
    if (user) {
      try {
        this.userRole = user.role || 'User';
        this.userLocation = this.formatUserLocation(user);
      } catch (error) {
        console.error('Error parsing user data:', error);
        this.userRole = 'User';
        this.userLocation = 'Not assigned';
      }
    } else {
      this.userRole = 'User';
      this.userLocation = 'Not assigned';
    }

    const role = (this.userRole || '').toUpperCase();
    this.isUser = role === 'USER' || role === 'MANAGER';
  }

  private getStoredUser(): any | null {
    const rawUser = localStorage.getItem('user');
    if (!rawUser) {
      return null;
    }

    try {
      return JSON.parse(rawUser);
    } catch (error) {
      console.error('Error parsing user data:', error);
      return null;
    }
  }

  private formatUserLocation(userData: any): string {
    const buildingName = String(userData?.building_name || '').trim();
    const roomName = String(userData?.room_name || '').trim();
    const cubicleLabel = String(userData?.cubicle_label || '').trim();

    const parts = [
      buildingName,
      roomName ? `Room ${roomName}` : '',
      cubicleLabel ? `Cubicle ${cubicleLabel}` : ''
    ].filter((part) => part.length > 0);

    if (parts.length > 0) {
      return parts.join(' | ');
    }

    const fallbackLocation = String(
      userData?.location || userData?.assignedLocation || ''
    ).trim();

    return fallbackLocation || 'Not assigned';
  }

  private loadAssignedLocation() {
    const storedUser = this.getStoredUser();
    const userId = Number(storedUser?.id);

    if (!Number.isFinite(userId) || userId <= 0) {
      return;
    }

    this.userService.getUsers().subscribe({
      next: (response) => {
        const currentUser = Array.isArray(response?.users)
          ? response.users.find((user: any) => Number(user?.id) === userId)
          : null;

        if (!currentUser) {
          return;
        }

        const mergedUser = { ...storedUser, ...currentUser };
        localStorage.setItem('user', JSON.stringify(mergedUser));
        this.userName = mergedUser.username || mergedUser.name || 'User';
        this.userRole = mergedUser.role || 'User';
        this.userLocation = this.formatUserLocation(mergedUser);
        this.isUser = ['USER', 'MANAGER'].includes(String(this.userRole || '').toUpperCase());
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading assigned user location:', error);
      }
    });
  }

  toggleUserMenu() {
    this.loadUserName();
    this.loadUserRole();
    this.loadAssignedLocation();
    this.cdr.detectChanges();
    this.isUserMenuOpen = !this.isUserMenuOpen;
    if (!this.isUserMenuOpen) {
      this.showLanguageDropdown = false;
    }
  }

  logout() {
    localStorage.removeItem('user');
    this.router.navigate(['/home']);
    this.isUserMenuOpen = false;
  }

  switchAccount() {
    localStorage.removeItem('user');
    localStorage.removeItem('darkMode');
    this.isDarkMode = false;
    this.applyDarkMode(false);
    this.isUserMenuOpen = false;
    this.router.navigate(['/home']);
  }

  openNotificationSettings() {
    console.log('Opening notification settings');
    this.isUserMenuOpen = false;
  }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    localStorage.setItem('darkMode', this.isDarkMode.toString());
    this.applyDarkMode(this.isDarkMode);
  }

  private applyDarkMode(enabled: boolean) {
    if (enabled) {
      this.renderer.addClass(document.body, 'dark-theme');
    } else {
      this.renderer.removeClass(document.body, 'dark-theme');
    }
  }

  toggleLanguageDropdown() {
    this.showLanguageDropdown = !this.showLanguageDropdown;
  }

  selectLanguage(lang: Language) {
    this.currentLanguage = lang.code;
    localStorage.setItem('language', lang.code);
    this.showLanguageDropdown = false;
  }

  getLanguageLabel(): string {
    const lang = this.languages.find(l => l.code === this.currentLanguage);
    return lang ? lang.label : 'English';
  }

  navigate(route: string) {
    this.router.navigate([route]);
  }

  get homeRoute(): string {
    return this.isUser ? '/app/user-home' : '/app/it-home';
  }

  get floorplanRoute(): string {
    return this.isUser ? '/app/user-floorplan' : '/app/it-floorplan';
  }

  get itUsersRoute(): string {
    return '/app/it-users';
  }

  get requestRoute(): string {
    return this.isUser ? '/app/user-request' : '/app/it-request';
  }

  ngOnDestroy() {
    this.routerSubscription?.unsubscribe();
  }
}
