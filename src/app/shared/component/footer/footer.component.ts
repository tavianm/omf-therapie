import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Card } from 'primeng/card';
import { ScrollTop } from 'primeng/scrolltop';

@Component({
  selector: 'app-footer',
  imports: [CommonModule, ScrollTop, Card],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
})
export class FooterComponent {}
