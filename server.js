require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Middleware de Autenticação (Protege as rotas que exigem login)
const requireAuth = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });

    // O Supabase valida o JWT e devolve os dados reais do utilizador
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) return res.status(401).json({ error: 'Sessão inválida ou expirada' });
    
    req.user = user; // Injeta o utilizador na requisição para as próximas funções usarem
    next();
};

// Rota de Sessões Removida: O Supabase Auth trata agora do Registo e Login diretamente.

// Atualização de LGPD (agora usa a nova tabela 'users' e o ID do utilizador logado)
app.patch('/api/users/lgpd', requireAuth, async (req, res) => {
    const { accepted } = req.body;
    const { data, error } = await supabase.from('users').update({ lgpd_accepted: accepted }).eq('id', req.user.id).select();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Consentimento LGPD atualizado', data });
});

app.post('/api/stations/:stationId/queue', requireAuth, async (req, res) => {
    const { stationId } = req.params;
    
    const { data, error } = await supabase.from('queues').insert([{ station_id: stationId, user_id: req.user.id }]);
    if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.message });
    
    res.status(201).json({ message: 'Registado na fila com sucesso', data });
});

app.delete('/api/stations/:stationId/queue', requireAuth, async (req, res) => {
    const { stationId } = req.params;
    
    const { error } = await supabase.from('queues').delete().eq('station_id', stationId).eq('user_id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    
    res.status(200).json({ message: 'Registo removido' });
});

app.post('/api/stations/:stationId/report', requireAuth, async (req, res) => {
    const { stationId } = req.params;
    const { issue_type } = req.body;
    
    const { data, error } = await supabase.from('reports').insert([{ station_id: stationId, user_id: req.user.id, issue_type }]);
    if (error) return res.status(500).json({ error: error.message });
    
    res.status(201).json({ message: 'Erro reportado com sucesso', data });
});

// A rota /nearby não usa o requireAuth porque visitantes não logados ainda podem ver o mapa.
app.get('/api/stations/nearby', async (req, res) => {
    const { lat, lng, radius = 15 } = req.query;
    const apiKey = process.env.OPEN_CHARGE_MAP_KEY;
    const token = req.headers.authorization?.split(' ')[1];

    // Se houver token, tentamos extrair o ID do utilizador para os botões do frontend
    let userId = null;
    if (token) {
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) userId = user.id;
    }

    try {
        const response = await axios.get('https://api.openchargemap.io/v3/poi/', {
            params: { output: 'json', latitude: lat, longitude: lng, distance: radius, distanceunit: 'KM', maxresults: 50, compact: true, key: apiKey },
            headers: { 'User-Agent': 'CarregadorFacil-App/1.0' }
        });

        const stations = response.data;
        const stationIds = stations.map(s => String(s.ID));

        // Note a alteração de session_token para user_id nas consultas
        const { data: queues } = await supabase.from('queues').select('station_id, user_id').in('station_id', stationIds);
        const { data: reports } = await supabase.from('reports').select('station_id').in('station_id', stationIds);

        const enrichedStations = stations.map(station => {
            const stationId = String(station.ID);
            const stationQueue = queues?.filter(q => q.station_id === stationId) || [];
            const queueCount = stationQueue.length;
            const isDamaged = reports?.some(r => r.station_id === stationId) || false;
            
            // Verifica se o ID do utilizador autenticado está nesta fila
            const isCurrentUserInQueue = userId ? stationQueue.some(q => q.user_id === userId) : false;

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