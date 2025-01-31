import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Card } from 'primeng/card';

@Component({
  selector: 'app-etapes',
  imports: [CommonModule, Card],
  templateUrl: './etapes.component.html',
  styleUrl: './etapes.component.scss',
})
export class EtapesComponent {}
