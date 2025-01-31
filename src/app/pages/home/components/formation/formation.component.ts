import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component } from '@angular/core';
import { Card } from 'primeng/card';

@Component({
  selector: 'app-formation',
  imports: [CommonModule, Card, NgOptimizedImage],
  templateUrl: './formation.component.html',
  styleUrl: './formation.component.scss',
})
export class FormationComponent {}
