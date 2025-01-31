import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ActionsComponent,
  EtapesComponent,
  FormationComponent,
  HeroComponent,
  PresentationComponent,
  PrixComponent,
} from './components';

@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    ActionsComponent,
    EtapesComponent,
    FormationComponent,
    HeroComponent,
    PresentationComponent,
    PrixComponent,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePageComponent {}
