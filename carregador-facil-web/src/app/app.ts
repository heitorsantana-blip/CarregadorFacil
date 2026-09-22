import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import * as L from 'leaflet';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `<div id="map" style="height: 100vh; width: 100vw;"></div>`
})
export class App implements OnInit {
  private map!: L.Map;
  private apiUrl = 'http://localhost:3000/api/stations/nearby';

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.initMap();
    this.loadStations();
  }

  private initMap() {
    this.map = L.map('map').setView([-12.9714, -38.5114], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);
  }

  private loadStations() {
    const token = localStorage.getItem('carregadorFacil_token');
    let headers = new HttpHeaders();
    if (token) headers = headers.set('Authorization', `Bearer ${token}`);
    
    this.http.get<any[]>(`${this.apiUrl}?lat=-12.9714&lng=-38.5114&radius=15`, { headers })
      .subscribe(stations => {
        this.map.eachLayer(layer => {
          if (layer instanceof L.Marker) this.map.removeLayer(layer);
        });

        stations.forEach(station => {
          const color = this.getMarkerColor(station.status);
          const markerHtml = `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`;
          const icon = L.divIcon({ html: markerHtml, className: 'custom-marker', iconSize: [24, 24] });

          const btnFilaHtml = station.isCurrentUserInQueue 
            ? `<button id="btn-sair-${station.id}" style="padding: 5px 10px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">Sair da Fila</button>`
            : `<button id="btn-fila-${station.id}" style="padding: 5px 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Entrar na Fila</button>`;

          const marker = L.marker([station.location.lat, station.location.lng], { icon })
            .addTo(this.map)
            .bindPopup(`
              <div style="font-family: Arial, sans-serif;">
                <strong>${station.name}</strong><br>
                Status: <b>${station.status.toUpperCase()}</b><br>
                Fila: ${station.carsInQueue} carros<br>
                <div style="display: flex; gap: 5px; margin-top: 10px;">
                  ${btnFilaHtml}
                  <button id="btn-reporte-${station.id}" style="padding: 5px 10px; background: #ffc107; color: black; border: none; border-radius: 4px; cursor: pointer;">Reportar</button>
                </div>
              </div>
            `);

          marker.on('popupopen', () => {
            if (station.isCurrentUserInQueue) {
              const btnSair = document.getElementById(`btn-sair-${station.id}`);
              if (btnSair) btnSair.addEventListener('click', () => this.sairDaFila(station.id));
            } else {
              const btnFila = document.getElementById(`btn-fila-${station.id}`);
              if (btnFila) btnFila.addEventListener('click', () => this.entrarNaFila(station.id));
            }

            const btnReporte = document.getElementById(`btn-reporte-${station.id}`);
            if (btnReporte) btnReporte.addEventListener('click', () => this.reportarErro(station.id));
          });
        });
      });
  }

  private async entrarNaFila(stationId: string) {
    const tokenKey = 'carregadorFacil_token';
    let token = localStorage.getItem(tokenKey);
    try {
      if (!token) {
        const session: any = await lastValueFrom(this.http.post('http://localhost:3000/api/sessions', {}));
        token = session.token;
        localStorage.setItem(tokenKey, token!);
      }
      const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
      await lastValueFrom(this.http.post(`http://localhost:3000/api/stations/${stationId}/queue`, {}, { headers }));
      this.loadStations();
    } catch (error: any) {
      alert(`Aviso: ${error.error?.error || 'Erro'}`);
    }
  }

  private async sairDaFila(stationId: string) {
    const token = localStorage.getItem('carregadorFacil_token');
    if (!token) return;
    try {
      const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
      await lastValueFrom(this.http.delete(`http://localhost:3000/api/stations/${stationId}/queue`, { headers }));
      this.loadStations();
    } catch (error) {
      alert('Erro ao tentar sair da fila.');
    }
  }

  private async reportarErro(stationId: string) {
    const issueType = prompt('Qual o problema? (ex: Conector quebrado)');
    if (!issueType) return;
    const tokenKey = 'carregadorFacil_token';
    let token = localStorage.getItem(tokenKey);
    try {
      if (!token) {
        const session: any = await lastValueFrom(this.http.post('http://localhost:3000/api/sessions', {}));
        token = session.token;
        localStorage.setItem(tokenKey, token!);
      }
      const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
      await lastValueFrom(this.http.post(`http://localhost:3000/api/stations/${stationId}/report`, { issue_type: issueType }, { headers }));
      alert('Problema reportado! O mapa será atualizado.');
      this.loadStations();
    } catch (error: any) {
      alert(`Aviso: ${error.error?.error || 'Erro'}`);
    }
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