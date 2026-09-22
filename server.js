require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.post('/api/sessions', async (req, res) => {
    const { data, error } = await supabase.from('sessions').insert([{}]).select('token').single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.patch('/api/sessions/:token/lgpd', async (req, res) => {
    const { token } = req.params;
    const { accepted } = req.body;
    const { data, error } = await supabase.from('sessions').update({ lgpd_accepted: accepted }).eq('token', token).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Consentimento LGPD atualizado', data });
});

app.post('/api/stations/:stationId/queue', async (req, res) => {
    const { stationId } = req.params;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    const { data, error } = await supabase.from('queues').insert([{ station_id: stationId, session_token: token }]);
    if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.message });
    res.status(201).json({ message: 'Registado na fila com sucesso', data });
});

app.delete('/api/stations/:stationId/queue', async (req, res) => {
    const { stationId } = req.params;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    const { error } = await supabase.from('queues').delete().eq('station_id', stationId).eq('session_token', token);
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ message: 'Registo removido' });
});

app.post('/api/stations/:stationId/report', async (req, res) => {
    const { stationId } = req.params;
    const { issue_type } = req.body;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    const { data, error } = await supabase.from('reports').insert([{ station_id: stationId, session_token: token, issue_type }]);
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ message: 'Erro reportado com sucesso', data });
});

app.get('/api/stations/nearby', async (req, res) => {
    const { lat, lng, radius = 15 } = req.query;
    const apiKey = process.env.OPEN_CHARGE_MAP_KEY;
    const token = req.headers.authorization?.split(' ')[1];

    try {
        const response = await axios.get('https://api.openchargemap.io/v3/poi/', {
            params: { output: 'json', latitude: lat, longitude: lng, distance: radius, distanceunit: 'KM', maxresults: 50, compact: true, key: apiKey },
            headers: { 'User-Agent': 'CarregadorFacil-App/1.0' }
        });

        const stations = response.data;
        const stationIds = stations.map(s => String(s.ID));

        const { data: queues } = await supabase.from('queues').select('station_id, session_token').in('station_id', stationIds);
        const { data: reports } = await supabase.from('reports').select('station_id').in('station_id', stationIds);

        const enrichedStations = stations.map(station => {
            const stationId = String(station.ID);
            const stationQueue = queues?.filter(q => q.station_id === stationId) || [];
            const queueCount = stationQueue.length;
            const isDamaged = reports?.some(r => r.station_id === stationId) || false;
            const isCurrentUserInQueue = token ? stationQueue.some(q => q.session_token === token) : false;

            let status = 'vazio';
            if (isDamaged) status = 'danificado';
            else if (queueCount > 0) status = 'com fila';

            return {
                id: stationId,
                name: station.AddressInfo?.Title || 'Posto de Carregamento',
                location: { lat: station.AddressInfo?.Latitude, lng: station.AddressInfo?.Longitude },
                status: status,
                carsInQueue: queueCount,
                isCurrentUserInQueue: isCurrentUserInQueue
            };
        });

        res.json(enrichedStations);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao carregar postos', details: error.message });
    }
});

app.listen(process.env.PORT || 3000, () => console.log(`API rodando na porta ${process.env.PORT || 3000}`));