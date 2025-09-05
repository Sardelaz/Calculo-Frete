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
    if (typeof key !== 'string') return '';
    return key
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
        .trim()
        .toLowerCase()
        .replace(/[_ ]/g, '');
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
                return;
            }

            const cepInicial = Number((row[cepInicialKey] || '0').toString().replace(/\D/g, ''));
            const cepFinal = Number((row[cepFinalKey] || '0').toString().replace(/\D/g, ''));

            if (cepInicial && cepFinal) {
                ceps.push({
                    UF: row[ufKey],
                    Cidade: row[cidadeKey],
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

            const cleanedRow = { ...row };

            const origemKey = Object.keys(row).find(k => normalizeKey(k) === 'origem');
            const destinoKey = Object.keys(row).find(k => normalizeKey(k) === 'destino');
            const classificacaoKey = Object.keys(row).find(k => normalizeKey(k) === 'classificacao');
            const servicoKey = Object.keys(row).find(k => normalizeKey(k) === 'servico');

            if (!origemKey || !destinoKey) {
                return;
            }
            
            cleanedRow._origem = normalizeString(row[origemKey]);
            cleanedRow._destino = normalizeString(row[destinoKey]);
            cleanedRow._classificacao = classificacaoKey ? normalizeString(row[classificacaoKey]) : '';
            cleanedRow._servico = servicoKey ? row[servicoKey] : 'Desconhecido';
            
            fretes.push(cleanedRow);
        } catch (err) {
            console.error('Erro ao processar linha de frete:', err, row);
        }
    })
    .on('end', () => console.log('Tabela de fretes carregada:', fretes.length, 'linhas'));

// --- FUNÇÕES DE CONSULTA ---
function encontrarCep(cepNum) {
    return ceps.find(c => cepNum >= c['CEP Inicial'] && cepNum <= c['CEP Final']);
}

function calcularValorFrete(linha, peso) {
    if (!linha) return null;

    const pesosInfo = Object.keys(linha)
        .map(k => ({ key: k, value: parseFloat(k.replace(',', '.')) }))
        .filter(item => !isNaN(item.value) && typeof item.key === 'string' && /^[0-9,.]+$/.test(item.key))
        .sort((a, b) => a.value - b.value);

    if (pesosInfo.length === 0) return null;

    const colunasPeso = pesosInfo.map(p => p.value);
    const chavesPeso = pesosInfo.map(p => p.key);

    if (peso <= colunasPeso[0]) {
        return parseFloat(linha[chavesPeso[0]].toString().replace(',', '.'));
    }
    if (peso >= colunasPeso[colunasPeso.length - 1]) {
        return parseFloat(linha[chavesPeso[colunasPeso.length - 1]].toString().replace(',', '.'));
    }

    for (let i = 0; i < colunasPeso.length - 1; i++) {
        if (peso >= colunasPeso[i] && peso <= colunasPeso[i + 1]) {
            const v1 = parseFloat(linha[chavesPeso[i]].toString().replace(',', '.')) || 0;
            const v2 = parseFloat(linha[chavesPeso[i + 1]].toString().replace(',', '.')) || 0;
            const p1 = colunasPeso[i];
            const p2 = colunasPeso[i + 1];
            return (v1 + ((v2 - v1) / (p2 - p1)) * (peso - p1));
        }
    }
    return null;
}

// --- ROTA PRINCIPAL ---
app.post('/consultarTodos', (req, res) => {
    try {
        const { cep, peso, valorPedido } = req.body;
        const cepLimpo = (cep || '').replace(/\D/g, '');
        const pesoNum = parseFloat(peso);
        const valorPedidoNum = parseFloat(valorPedido);

        if (!cepLimpo || isNaN(pesoNum) || isNaN(valorPedidoNum)) {
            return res.status(400).json({ error: 'CEP, peso ou valor do pedido inválido.' });
        }

        const cepNum = Number(cepLimpo);
        const cepInfo = encontrarCep(cepNum);
        if (!cepInfo) return res.json({ error: 'CEP não encontrado.' });

        const origem = 'sp';
        const destino = normalizeString(cepInfo.UF);
        const tipoCep = normalizeString(cepInfo.Tipo);

        const linhasDestino = fretes.filter(f =>
            f._destino === destino &&
            f._origem === origem &&
            f._classificacao === tipoCep
        );

        if (linhasDestino.length === 0) {
            return res.json({ error: `Nenhum serviço do tipo '${cepInfo.Tipo}' foi encontrado para a UF '${cepInfo.UF}'.` });
        }

        const resultado = linhasDestino.map(f => {
            const valorBase = calcularValorFrete(f, pesoNum);
            if (valorBase === null) {
                return {
                    servico: f._servico,
                    valor: 'Não disponível',
                    prazo: cepInfo.Prazo
                };
            }
            
            // **CORREÇÃO**: Calcula a taxa e soma ao valor base do frete
            const taxa = valorPedidoNum * 0.013;
            const valorFinal = valorBase + taxa;

            return {
                servico: f._servico,
                valor: `R$ ${valorFinal.toFixed(2).replace('.', ',')}`,
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