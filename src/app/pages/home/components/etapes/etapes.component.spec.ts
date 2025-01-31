import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EtapesComponent } from './etapes.component';

describe('EtapesComponent', () => {
  let component: EtapesComponent;
  let fixture: ComponentFixture<EtapesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EtapesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EtapesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
