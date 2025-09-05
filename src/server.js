const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const csv = require('csv-parser');
const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

let ceps = [];
let fretes = [];

// Função para normalizar strings (trim, minúscula, remover acentos)
function normalizeString(str) {
    if (!str) return '';
    return str
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
        .trim()
        .toLowerCase();
}

// Função para normalizar nomes de colunas
function normalizeKey(key) {
    return typeof key === 'string' ? key.trim().toLowerCase().replace(/[_ ]/g, '') : '';
}

// --- CARREGAR TABELA DE CEPs ---
fs.createReadStream('./data/faixas_cep_azul.csv')
    .pipe(csv({ separator: ',' }))
    .on('data', (row) => {
        try {
            if (!row || Object.keys(row).length === 0) return;

            const cepInicialKey = Object.keys(row).find(k => normalizeKey(k) === 'cepinicial');
            const cepFinalKey = Object.keys(row).find(k => normalizeKey(k) === 'cepfinal');
            const cidadeKey = Object.keys(row).find(k => normalizeKey(k) === 'cidade');
            const ufKey = Object.keys(row).find(k => normalizeKey(k) === 'uf');
            const tipoKey = Object.keys(row).find(k => normalizeKey(k) === 'tipo');
            const prazoKey = Object.keys(row).find(k => normalizeKey(k) === 'prazo');

            if (!cepInicialKey || !cepFinalKey || !cidadeKey || !ufKey || !tipoKey || !prazoKey) {
                console.log('Linha ignorada (faltando coluna):', row);
                return;
            }

            const cepInicial = Number((row[cepInicialKey] || '0').toString().replace(/\D/g, ''));
            const cepFinal = Number((row[cepFinalKey] || '0').toString().replace(/\D/g, ''));

            if (cepInicial && cepFinal) {
                ceps.push({
                    UF: row[ufKey],
                    Cidade: normalizeString(row[cidadeKey]),
                    Tipo: row[tipoKey],
                    Prazo: row[prazoKey],
                    'CEP Inicial': cepInicial,
                    'CEP Final': cepFinal
                });
            }
        } catch (err) {
            console.error('Erro ao processar linha de CEP:', err, row);
        }
    })
    .on('end', () => console.log('Tabela de CEPs carregada:', ceps.length, 'linhas'));

// --- CARREGAR TABELA DE FRETES ---
fs.createReadStream('./data/SHATARK-SP-ECM.csv')
    .pipe(csv({ separator: ';' }))
    .on('data', (row) => {
        try {
            if (!row || Object.keys(row).length === 0) return;

            // Normalizar ORIGEM e DESTINO
            row.ORIGEM = normalizeString(row.ORIGEM);
            row.DESTINO = normalizeString(row.DESTINO);

            fretes.push(row);
        } catch (err) {
            console.error('Erro ao processar linha de frete:', err, row);
        }
    })
    .on('end', () => console.log('Tabela de fretes carregada:', fretes.length, 'linhas'));

// --- FUNÇÕES DE CONSULTA ---
function encontrarCep(cepNum) {
    return ceps.find(c => cepNum >= c['CEP Inicial'] && cepNum <= c['CEP Final']);
}

function origemPorUF(uf) {
    const capitais = ceps.filter(c => c.UF === uf && normalizeString(c.Tipo) === 'capital');
    return capitais.length > 0 ? capitais[0].Cidade : null;
}

function calcularFrete(origem, destino, peso) {
    origem = normalizeString(origem);
    destino = normalizeString(destino);

    const linha = fretes.find(f => f.ORIGEM === origem && f.DESTINO === destino);
    if (!linha) return null;

    const colunasPeso = Object.keys(linha)
        .filter(k => !isNaN(parseFloat(k.replace(',', '.'))))
        .map(Number)
        .sort((a, b) => a - b);

    if (peso <= colunasPeso[0]) return parseFloat(linha[colunasPeso[0]].toString().replace(',', '.')).toFixed(2);
    if (peso >= colunasPeso[colunasPeso.length - 1]) return parseFloat(linha[colunasPeso[colunasPeso.length - 1]].toString().replace(',', '.')).toFixed(2);

    for (let i = 0; i < colunasPeso.length - 1; i++) {
        if (peso >= colunasPeso[i] && peso <= colunasPeso[i + 1]) {
            const v1 = parseFloat(linha[colunasPeso[i]].toString().replace(',', '.')) || 0;
            const v2 = parseFloat(linha[colunasPeso[i + 1]].toString().replace(',', '.')) || 0;
            const p1 = colunasPeso[i];
            const p2 = colunasPeso[i + 1];
            return (v1 + ((v2 - v1) / (p2 - p1)) * (peso - p1)).toFixed(2);
        }
    }
    return null;
}

// --- ROTAS ---
app.post('/consultar', (req, res) => {
    try {
        const cep = (req.body.cep || '').replace(/\D/g, '');
        const peso = parseFloat(req.body.peso);
        if (!cep || isNaN(peso)) return res.json({ error: 'CEP ou peso inválido' });

        const cepNum = Number(cep);
        const cepInfo = encontrarCep(cepNum);
        if (!cepInfo) return res.json({ error: 'CEP não encontrado' });

        const origem = origemPorUF(cepInfo.UF);
        if (!origem) return res.json({ error: 'Origem não definida para este UF' });

        const valorFrete = calcularFrete(origem, cepInfo.Cidade, peso);
        res.json({
            cidade: cepInfo.Cidade,
            uf: cepInfo.UF,
            tipo: cepInfo.Tipo,
            prazo: cepInfo.Prazo,
            frete: valorFrete ? `R$ ${valorFrete}` : 'Frete não disponível'
        });
    } catch (err) {
        console.error('Erro na rota /consultar:', err);
        res.status(500).json({ error: 'Erro interno no servidor' });
    }
});

app.post('/consultarTodos', (req, res) => {
    try {
        const cep = (req.body.cep || '').replace(/\D/g, '');
        const peso = parseFloat(req.body.peso);
        if (!cep || isNaN(peso)) return res.json({ error: 'CEP ou peso inválido' });

        const cepNum = Number(cep);
        const cepInfo = encontrarCep(cepNum);
        if (!cepInfo) return res.json({ error: 'CEP não encontrado' });

        const origem = origemPorUF(cepInfo.UF);
        if (!origem) return res.json({ error: 'Origem não definida para este UF' });

        const destino = normalizeString(cepInfo.Cidade);
        const origemNorm = normalizeString(origem);

        const linhasDestino = fretes.filter(f => f.DESTINO === destino && f.ORIGEM === origemNorm);
        if (linhasDestino.length === 0) return res.json({ error: 'Nenhum serviço disponível para este destino' });

        const resultado = linhasDestino.map(f => {
            const colunasPeso = Object.keys(f)
                .filter(k => !isNaN(parseFloat(k.replace(',', '.'))))
                .map(Number)
                .sort((a, b) => a - b);

            let valor;
            if (peso <= colunasPeso[0]) valor = parseFloat(f[colunasPeso[0]].toString().replace(',', '.')).toFixed(2);
            else if (peso >= colunasPeso[colunasPeso.length - 1]) valor = parseFloat(f[colunasPeso[colunasPeso.length - 1]].toString().replace(',', '.')).toFixed(2);
            else {
                for (let i = 0; i < colunasPeso.length - 1; i++) {
                    if (peso >= colunasPeso[i] && peso <= colunasPeso[i + 1]) {
                        const v1 = parseFloat(f[colunasPeso[i]].toString().replace(',', '.')) || 0;
                        const v2 = parseFloat(f[colunasPeso[i + 1]].toString().replace(',', '.')) || 0;
                        const p1 = colunasPeso[i];
                        const p2 = colunasPeso[i + 1];
                        valor = (v1 + ((v2 - v1) / (p2 - p1)) * (peso - p1)).toFixed(2);
                        break;
                    }
                }
            }

            return {
                servico: f.SERVICO || f.Serviço || 'Desconhecido',
                classificacao: f.CLASSIFICACAO || f.Classificação || '',
                valor: `R$ ${valor}`,
                prazo: cepInfo.Prazo
            };
        });

        res.json({
            cidade: cepInfo.Cidade,
            uf: cepInfo.UF,
            tipo: cepInfo.Tipo,
            frete: resultado
        });
    } catch (err) {
        console.error('Erro na rota /consultarTodos:', err);
        res.status(500).json({ error: 'Erro interno no servidor' });
    }
});

// --- INICIAR SERVIDOR ---
app.listen(8080, () => console.log('Servidor rodando em http://localhost:8080'));
