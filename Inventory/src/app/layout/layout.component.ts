import { Component, OnInit, ChangeDetectorRef, Renderer2, OnDestroy } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';

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
    private renderer: Renderer2
  ) {}

  ngOnInit() {
    this.loadUserName();
    this.loadUserRole();

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
      }
    });

    this.cdr.detectChanges();
  }

  loadUserName() {
    const user = localStorage.getItem('user');
    if (user) {
      try {
        const userData = JSON.parse(user);
        this.userName = userData.username || userData.name || 'User';
      } catch (error) {
        console.error('Error parsing user data:', error);
        this.userName = 'User';
      }
    } else {
      this.userName = 'User';
    }
  }

  loadUserRole() {
    const user = localStorage.getItem('user');
    if (user) {
      try {
        const userData = JSON.parse(user);
        this.userRole = userData.role || 'User';
      } catch (error) {
        console.error('Error parsing user data:', error);
        this.userRole = 'User';
      }
    } else {
      this.userRole = 'User';
    }

    const role = (this.userRole || '').toUpperCase();
    this.isUser = role === 'USER' || role === 'MANAGER';
  }

  toggleUserMenu() {
    this.loadUserName();
    this.loadUserRole();
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

  get requestRoute(): string {
    return this.isUser ? '/app/user-request' : '/app/it-request';
  }

  ngOnDestroy() {
    this.routerSubscription?.unsubscribe();
  }
}
