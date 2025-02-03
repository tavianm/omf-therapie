import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { EmailJSResponseStatus, send } from '@emailjs/browser';
import { MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { FloatLabel } from 'primeng/floatlabel';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { Toast } from 'primeng/toast';

@Component({
  selector: 'app-contact',
  imports: [
    CommonModule,
    Card,
    ReactiveFormsModule,
    InputText,
    Textarea,
    Button,
    Toast,
    FloatLabel,
  ],
  providers: [MessageService],
  templateUrl: './contact.page.html',
  styleUrl: './contact.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactPageComponent {
  formbuilder = inject(FormBuilder);
  messageService = inject(MessageService);

  contactForm = this.formbuilder.group({
    name: new FormControl('', Validators.required),
    firstName: new FormControl(''),
    phone: new FormControl('', Validators.pattern('^[0-9]{10}$')),
    email: new FormControl('', [Validators.required, Validators.email]),
    subject: new FormControl('', Validators.required),
    message: new FormControl('', [
      Validators.required,
      Validators.maxLength(500),
    ]),
  });

  public sendEmail(e: Event) {
    if (this.contactForm.invalid) {
      Object.keys(this.contactForm.controls).forEach((key) => {
        this.contactForm.get(key)?.markAsDirty();
      });
      this.messageService.add({
        severity: 'error',
        summary: 'Attention',
        detail: 'Certains champs sont requis.',
      });
      return;
    }
    e.preventDefault();

    send('service_bdzolup', 'template_ora67us', this.contactForm.value, {
      publicKey: 'a16S46gFg6v_HVO3I',
    }).then(
      () => {
        console.log('SUCCESS!');
        this.contactForm.reset();
      },
      (error) => {
        console.log('FAILED...', (error as EmailJSResponseStatus).text);
      }
    );
  }
}
