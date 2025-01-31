import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component } from '@angular/core';
import { Card } from 'primeng/card';

@Component({
  selector: 'app-presentation',
  imports: [CommonModule, NgOptimizedImage, Card],
  templateUrl: './presentation.component.html',
  styleUrl: './presentation.component.scss',
})
export class PresentationComponent {}
