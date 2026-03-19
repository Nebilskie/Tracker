import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false
})
export class HomePage {

  username = '';
  password = '';
  isLoading = false;
  errorMessage = '';

  constructor(
    private http: HttpClient,
    private router: Router
  ) {}

  login(event?: any) {
    if (event) {
      event.preventDefault();
    }

    if (!this.username || !this.password) {
      this.errorMessage = 'Please enter both username and password';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.http.post<any>('http://localhost:3000/login', {
      username: this.username,
      password: this.password
    }).subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res.success) {
          const role = res.user.role?.toUpperCase();
          localStorage.setItem('user', JSON.stringify(res.user));

          if (role === 'IT' || role === 'ADMIN') {
            this.router.navigate(['/app/it-home']);
          } else if (role === 'USER' || role === 'MANAGER') {
            this.router.navigate(['/app/user-home']);
          } else {
            this.errorMessage = 'Unknown role';
          }
        } else {
          this.errorMessage = 'Wrong password or username';
        }
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = 'Wrong password or username';
        console.error('Login error:', err);
      }
    });
  }
}

