import { CommonModule } from '@angular/common';
import { Component, ViewEncapsulation } from '@angular/core';
import { MenuItem } from 'primeng/api';
import { Menubar } from 'primeng/menubar';

@Component({
  selector: 'app-menu',
  imports: [CommonModule, Menubar],
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class MenuComponent {
  myMenuBar = {
    'border.color': 'transparent',
    item: { 'focus.background': '{primary.100}', padding: '1rem' },
    'base.item': { padding: '1rem' },
    gap: '1rem',
    padding: '2rem',
  };

  items: MenuItem[] = [
    {
      label: 'Qui suis-je?',
      routerLink: ['/'],
      command: () => this.scroll('presentation'),
    },
    {
      label: 'Mon parcours',
      routerLink: ['/'],
      command: () => this.scroll('formation'),
    },
    {
      label: "Champs d'actions",
      routerLink: ['/'],
      command: () => this.scroll('actions'),
    },
    {
      label: 'Etapes',
      routerLink: ['/'],
      command: () => this.scroll('etapes'),
    },
    {
      label: 'Tarifs',
      routerLink: ['/'],
      command: () => this.scroll('tarifs'),
    },
    {
      label: 'Contact',
      routerLink: ['/contact'],
    },
  ];

  scroll(el: string) {
    setTimeout(() => {
      const htmlElement = document.getElementById(el);
      htmlElement?.scrollIntoView({ behavior: 'smooth' });
    }, 200);
  }
}
