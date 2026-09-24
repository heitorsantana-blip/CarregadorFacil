import { Component, OnInit, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import * as L from 'leaflet';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html'
})
export class App implements OnInit {
  private map!: L.Map;
  private apiUrl = 'http://localhost:3000/api/stations/nearby';
  private supabase: SupabaseClient;

  // Variáveis de Autenticação
  sessaoAtiva = false;
  userEmail = '';
  showAuthModal = false;
  isLoginMode = true;

  // Variáveis de UI
  showToast = false;
  toastMessage = '';
  showModal = false;
  modalStationId = '';
  showConfirm = false;
  confirmMessage = '';
  lgpdAceita = false;
  confirmAction!: () => void;

  constructor(private http: HttpClient, private zone: NgZone, private cdr: ChangeDetectorRef) {
    // COLOQUE AS SUAS CREDENCIAIS DO SUPABASE AQUI
    this.supabase = createClient('https://yrprrbqzdbbfngkhcghv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlycHJyYnF6ZGJiZm5na2hjZ2h2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjY4NTksImV4cCI6MjEwNTMwMjg1OX0.4ByLWhQtj6CipvAqUyPFsNEeznbk0o1AUnQKGw6cgKM');
  }

  async ngOnInit() {
    this.initMap();
    await this.verificarSessao();
    this.buscarLocalizacaoUsuario();
  }

  // --- Autenticação Supabase ---
  private async verificarSessao() {
    const { data: { session } } = await this.supabase.auth.getSession();
    this.atualizarEstadoAutenticacao(session);

    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.atualizarEstadoAutenticacao(session);
    });
  }

  private atualizarEstadoAutenticacao(session: any) {
    if (session) {
      this.sessaoAtiva = true;
      this.userEmail = session.user.email;
    } else {
      this.sessaoAtiva = false;
      this.userEmail = '';
    }
    this.cdr.detectChanges();
  }

  async processarAuth(email: string, pass: string) {
    if (!email || !pass) {
      this.mostrarToast('Preencha os campos obrigatórios.');
      return;
    }

    // Validação da LGPD para novos registos
    if (!this.isLoginMode && !this.lgpdAceita) {
      this.mostrarToast('É obrigatório aceitar os Termos e a LGPD para continuar.');
      return;
    }

    try {
      let result;
      if (this.isLoginMode) {
        result = await this.supabase.auth.signInWithPassword({ email, password: pass });
        if (result.error) throw result.error;
        this.mostrarToast('Login bem-sucedido!');
      } else {
        result = await this.supabase.auth.signUp({ email, password: pass });
        if (result.error) throw result.error;
        
        // Se registou com sucesso, avisa a API Node.js sobre o consentimento LGPD
        if (result.data.session) {
          const token = result.data.session.access_token;
          const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
          await lastValueFrom(this.http.patch('http://localhost:3000/api/users/lgpd', { accepted: true }, { headers }));
        }
        
        this.mostrarToast('Conta criada com sucesso!');
      }

      this.fecharAuthModal();
      this.atualizarMapaNoLugar();
    } catch (error: any) {
      this.mostrarToast(`Erro: ${error.message}`);
    }
  }

  async fazerLogout() {
    await this.supabase.auth.signOut();
    this.mostrarToast('Sessão terminada.');
    this.atualizarMapaNoLugar();
  }

  // --- Funções Auxiliares de API para Obter o Token JWT Seguro ---
  private async getAuthHeaders(): Promise<HttpHeaders | null> {
    const { data: { session } } = await this.supabase.auth.getSession();
    if (!session) return null;
    return new HttpHeaders().set('Authorization', `Bearer ${session.access_token}`);
  }

  // --- Mapa e APIs ---
  private initMap() {
    this.map = L.map('map').setView([-12.9714, -38.5114], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);
  }

  private buscarLocalizacaoUsuario() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          this.map.flyTo([lat, lng], 15, { animate: true, duration: 1.5 });
          this.loadStations(lat, lng);
        },
        () => {
          this.mostrarToast('Acesso à localização negado. Exibindo região padrão.');
          this.loadStations(-12.9714, -38.5114);
        }
      );
    } else {
      this.loadStations(-12.9714, -38.5114);
    }
  }

  private async loadStations(lat: number, lng: number) {
    let headers = await this.getAuthHeaders();
    if (!headers) headers = new HttpHeaders(); // Envia sem token se não estiver logado
    
    this.http.get<any[]>(`${this.apiUrl}?lat=${lat}&lng=${lng}&radius=15`, { headers })
      .subscribe(stations => {
        this.map.eachLayer(layer => {
          if (layer instanceof L.Marker) this.map.removeLayer(layer);
        });

        stations.forEach(station => {
          const color = this.getMarkerColor(station.status);
          const markerHtml = `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`;
          const icon = L.divIcon({ html: markerHtml, className: 'custom-marker', iconSize: [24, 24] });

          const btnFilaHtml = station.isCurrentUserInQueue 
            ? `<button id="btn-sair" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Sair da Fila</button>`
            : `<button id="btn-fila" style="padding: 6px 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Entrar na Fila</button>`;

          const popupContent = document.createElement('div');
          popupContent.style.fontFamily = 'Arial, sans-serif';
          popupContent.style.minWidth = '200px';
          popupContent.innerHTML = `
            <strong style="font-size: 15px;">${station.name}</strong><br>
            <div style="margin: 8px 0; font-size: 13px;">
              Status: <b>${station.status.toUpperCase()}</b><br>
              Fila: <b>${station.carsInQueue}</b> veículos
            </div>
            <div style="display: flex; gap: 8px; margin-top: 12px;">
              ${btnFilaHtml}
              <button id="btn-reporte" style="padding: 6px 12px; background: #ffc107; color: black; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Reportar</button>
            </div>
          `;

          // Barreira de Autenticação ao tentar clicar
          const intercetarEValidarSessao = (acao: () => void) => {
            if (!this.sessaoAtiva) {
              this.abrirAuthModal();
            } else {
              acao();
            }
          };

          const btnSair = popupContent.querySelector('#btn-sair');
          if (btnSair) {
            btnSair.addEventListener('click', () => {
              this.zone.run(() => intercetarEValidarSessao(() => this.pedirConfirmacao('Deseja sair da fila?', () => this.sairDaFila(station.id))));
            });
          }

          const btnFila = popupContent.querySelector('#btn-fila');
          if (btnFila) {
            btnFila.addEventListener('click', () => {
              this.zone.run(() => intercetarEValidarSessao(() => this.pedirConfirmacao('Deseja entrar na fila deste posto?', () => this.entrarNaFila(station.id))));
            });
          }

          const btnReporte = popupContent.querySelector('#btn-reporte');
          if (btnReporte) {
            btnReporte.addEventListener('click', () => {
              this.zone.run(() => intercetarEValidarSessao(() => this.abrirModal(station.id)));
            });
          }

          L.marker([station.location.lat, station.location.lng], { icon })
            .addTo(this.map)
            .bindPopup(popupContent);
        });
      });
  }

  private async entrarNaFila(stationId: string) {
    try {
      const headers = await this.getAuthHeaders();
      await lastValueFrom(this.http.post(`http://localhost:3000/api/stations/${stationId}/queue`, {}, { headers: headers! }));
      this.mostrarToast('Registado na fila com sucesso!');
      this.atualizarMapaNoLugar();
    } catch (error: any) {
      this.mostrarToast(`Erro: ${error.error?.error || 'Falha ao entrar na fila'}`);
    }
  }

  private async sairDaFila(stationId: string) {
    try {
      const headers = await this.getAuthHeaders();
      await lastValueFrom(this.http.delete(`http://localhost:3000/api/stations/${stationId}/queue`, { headers: headers! }));
      this.mostrarToast('Saiu da fila.');
      this.atualizarMapaNoLugar();
    } catch (error) {
      this.mostrarToast('Erro ao tentar sair da fila.');
    }
  }

  async enviarReporte(issueType: string) {
    try {
      const headers = await this.getAuthHeaders();
      await lastValueFrom(this.http.post(`http://localhost:3000/api/stations/${this.modalStationId}/report`, { issue_type: issueType }, { headers: headers! }));
      this.fecharModal();
      this.mostrarToast('Alerta registado! O posto foi marcado como danificado.');
      this.atualizarMapaNoLugar();
    } catch (error: any) {
      this.fecharModal();
      this.mostrarToast(`Erro: ${error.error?.error || 'Falha ao reportar'}`);
    }
  }

  // --- Controles de Interface Visuais ---
  private atualizarMapaNoLugar() {
    const center = this.map.getCenter();
    this.loadStations(center.lat, center.lng);
  }

  abrirAuthModal() {
    this.showAuthModal = true;
    this.isLoginMode = true;
    this.cdr.detectChanges();
  }

  alternarModoAuth() {
    this.isLoginMode = !this.isLoginMode;
    this.lgpdAceita = false; // Reseta a caixa ao mudar de ecrã
    this.cdr.detectChanges();
  }

  fecharAuthModal() {
    this.showAuthModal = false;
    this.cdr.detectChanges();
  }

  mostrarToast(mensagem: string) {
    this.toastMessage = mensagem;
    this.showToast = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.showToast = false;
      this.cdr.detectChanges();
    }, 3500);
  }

  abrirModal(stationId: string) {
    this.modalStationId = stationId;
    this.showModal = true;
    this.cdr.detectChanges();
  }

  fecharModal() {
    this.showModal = false;
    this.modalStationId = '';
    this.cdr.detectChanges();
  }

  pedirConfirmacao(mensagem: string, acao: () => void) {
    this.confirmMessage = mensagem;
    this.confirmAction = acao;
    this.showConfirm = true;
    this.cdr.detectChanges();
  }

  fecharConfirmacao() {
    this.showConfirm = false;
    this.cdr.detectChanges();
  }

  executarConfirmacao() {
    if (this.confirmAction) this.confirmAction();
    this.fecharConfirmacao();
  }

  private getMarkerColor(status: string): string {
    switch (status) {
      case 'vazio': return '#28a745';
      case 'com fila': return '#007bff';
      case 'danificado': return '#dc3545';
      default: return '#6c757d';
    }
  }
}