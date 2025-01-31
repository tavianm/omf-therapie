import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component } from '@angular/core';
import { Card } from 'primeng/card';

@Component({
  selector: 'app-prix',
  imports: [CommonModule, NgOptimizedImage, Card],
  templateUrl: './prix.component.html',
  styleUrl: './prix.component.scss',
})
export class PrixComponent {}
