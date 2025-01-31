import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FooterComponent, MenuComponent } from '../../component';

@Component({
  selector: 'app-layout',
  imports: [CommonModule, RouterOutlet, MenuComponent, FooterComponent],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
})
export class LayoutComponent {}
