import { HttpClient } from '@angular/common/http';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { InventoryService } from '../services/inventory.service';

@Component({
  selector: 'app-it-home',
  templateUrl: './it-home.page.html',
  styleUrls: ['./it-home.page.scss'],
  standalone: false
})
export class ItHomePage implements OnInit, OnDestroy {
  totalItems = 0;
  availableItems = 0;
  defectiveItems = 0;
  usedItems = 0;

  inventoryItems: Array<{ name: string; available: number; defect: number; used: number; statusClass: string }> = [];

  activities: any[] = [];

  requestCounts = {
    new: 0,
    inProgress: 0,
    completed: 0
  };

  private refreshInterval: any;

  barChartData: ChartConfiguration<'bar'>['data'] = {
    labels: ['Monitor', 'Keyboard', 'Headset', 'Webcam', 'Mouse', 'WiFi'],
    datasets: [
      {
        label: 'Available',
        data: [12, 8, 5, 3, 15, 2],
        backgroundColor: 'rgba(102, 126, 234, 0.85)',
        borderRadius: 6,
        barThickness: 18
      },
      {
        label: 'Defective',
        data: [3, 2, 4, 1, 2, 5],
        backgroundColor: 'rgba(235, 68, 90, 0.7)',
        borderRadius: 6,
        barThickness: 18
      }
    ]
  };

  barChartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 16,
          font: { size: 11, family: "'Inter', sans-serif" },
          color: '#666'
        }
      },
      tooltip: {
        backgroundColor: 'rgba(30, 30, 60, 0.9)',
        titleFont: { size: 12, family: "'Inter', sans-serif" },
        bodyFont: { size: 11, family: "'Inter', sans-serif" },
        padding: 10,
        cornerRadius: 8,
        displayColors: true
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          color: '#999',
          font: { size: 11 },
          stepSize: 5
        },
        grid: { color: 'rgba(0,0,0,0.04)' },
        border: { display: false }
      },
      x: {
        ticks: {
          color: '#666',
          font: { size: 11 }
        },
        grid: { display: false },
        border: { display: false }
      }
    }
  };

  constructor(
    private http: HttpClient,
    private router: Router,
    private inventoryService: InventoryService
  ) {}

  ngOnInit() {
    this.loadInventoryStats();
    this.loadActivitiesAndCounts();

    // Auto-refresh every 5 seconds
    this.refreshInterval = setInterval(() => {
      this.loadActivitiesAndCounts();
    }, 5000);
  }

  ngOnDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  loadInventoryStats() {
    this.inventoryService.getSummary().subscribe(
      (response) => {
        if (response.success && Array.isArray(response.summary)) {
          const summary = response.summary;

          this.totalItems = summary.reduce((sum, item) => sum + Number(item.total || 0), 0);
          this.availableItems = summary.reduce((sum, item) => sum + Number(item.available || 0), 0);
          this.defectiveItems = summary.reduce((sum, item) => sum + Number(item.defects || 0), 0);
          this.usedItems = summary.reduce((sum, item) => sum + Number(item.used || 0), 0);

          this.inventoryItems = summary.map(item => ({
            name: item.name,
            available: Number(item.available || 0),
            defect: Number(item.defects || 0),
            used: Number(item.used || 0),
            statusClass: item.available > item.defects
              ? 'dot-green'
              : item.available === item.defects
              ? 'dot-amber'
              : 'dot-red'
          }));

          this.barChartData = {
            labels: summary.map(item => item.name),
            datasets: [
              {
                label: 'Available',
                data: summary.map(item => Number(item.available || 0)),
                backgroundColor: 'rgba(102, 126, 234, 0.85)',
                borderRadius: 6,
                barThickness: 18
              },
              {
                label: 'Used',
                data: summary.map(item => Number(item.used || 0)),
                backgroundColor: 'rgba(255, 159, 64, 0.8)',
                borderRadius: 6,
                barThickness: 18
              },
              {
                label: 'Defective',
                data: summary.map(item => Number(item.defects || 0)),
                backgroundColor: 'rgba(235, 68, 90, 0.7)',
                borderRadius: 6,
                barThickness: 18
              }
            ]
          };

          console.log('✅ Loaded inventory summary from API', response.summary);
        }
      },
      (error) => {
        console.error('❌ Error loading inventory summary:', error);
      }
    );
  }

  /**
   * Load activities and automatically update request counts
   */
  loadActivitiesAndCounts() {
    this.http.get<any>('http://localhost:3000/api/it-requests').subscribe(
      (response) => {
        if (response.success && Array.isArray(response.requests)) {
          const requests = response.requests;

          // Update Recent Activity
          this.activities = requests.map((req: any) => {
            const initials = this.getInitials(req.username);
            const statusConfig = this.getStatusConfig(req.status);
            const timeAgo = this.getTimeAgo(req.created_at);

            return {
              initials,
              user: req.username,
              action: req.request_text,
              time: timeAgo,
              color: this.getAvatarColor(initials),
              tag: statusConfig.tag,
              tagClass: statusConfig.tagClass
            };
          });

          // Update counts automatically from the same requests data
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);

          this.requestCounts.new = requests.filter((req: any) => req.status === 'new').length;

          this.requestCounts.inProgress = requests.filter(
            (req: any) => req.status === 'inprogress'
          ).length;

          this.requestCounts.completed = requests.filter((req: any) => {
            if (req.status !== 'completed') return false;
            const created = new Date(req.created_at);
            return created >= weekAgo;
          }).length;

          console.log('✅ Loaded activities and updated counts:', {
            activities: this.activities,
            requestCounts: this.requestCounts
          });
        }
      },
      (error) => {
        console.error('❌ Error loading activities and counts:', error);
      }
    );
  }

  /**
   * Get status display config
   */
  getStatusConfig(status: string): { tag: string; tagClass: string } {
    const statusMap: { [key: string]: { tag: string; tagClass: string } } = {
      new: { tag: 'New', tagClass: 'tag-blue' },
      inprogress: { tag: 'In Progress', tagClass: 'tag-amber' },
      completed: { tag: 'Completed', tagClass: 'tag-green' },
      rejected: { tag: 'Rejected', tagClass: 'tag-red' }
    };
    return statusMap[status] || { tag: 'Pending', tagClass: 'tag-blue' };
  }

  /**
   * Get initials from username
   */
  getInitials(username: string): string {
    if (!username) return 'UN';
    const parts = username.split(' ').filter((p: string) => p.trim().length > 0);
    return parts.map((p: string) => p[0]).join('').toUpperCase().substring(0, 2);
  }

  /**
   * Get avatar color based on initials hash
   */
  getAvatarColor(initials: string): string {
    const colors = ['avatar-blue', 'avatar-red', 'avatar-green', 'avatar-purple', 'avatar-amber'];
    let hash = 0;
    for (let i = 0; i < initials.length; i++) {
      hash = initials.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  /**
   * Format timestamp to "X ago" format
   */
  getTimeAgo(createdAt: string): string {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now.getTime() - created.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hr ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return created.toLocaleDateString();
  }

  handleClick() {
    this.router.navigate(['/app/it-inventory']);
  }

  navigateToRequests(status: string) {
    const normalized = status === 'in-progress' ? 'inprogress' : status;
    this.router.navigate(['/app/it-request'], { queryParams: { status: normalized } });
  }
}