import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component } from '@angular/core';
import { Button } from 'primeng/button';
import { Ripple } from 'primeng/ripple';

@Component({
  selector: 'app-hero',
  imports: [CommonModule, NgOptimizedImage, Button, Ripple],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.scss',
})
export class HeroComponent {}
