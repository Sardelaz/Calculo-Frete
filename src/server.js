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

// --- CARREGAR TABELA DE FRETES (LÓGICA FINAL E CORRIGIDA) ---
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

// --- FUNÇÃO DE CONSULTA (COM LÓGICA PARA PESOS > 30KG) 

function calcularValorFrete(linha, peso) {
    if (!linha) return null;

    const pesosInfo = Object.keys(linha)
        .map(k => ({ key: k, value: parseFloat(k.replace(',', '.')) }))
        .filter(item => !isNaN(item.value) && typeof item.key === 'string' && /^[0-9,.]+$/.test(item.key))
        .sort((a, b) => a.value - b.value);

    if (pesosInfo.length === 0) {
        console.log('[DIAGNÓSTICO] Nenhuma coluna de peso válida foi encontrada na linha de frete.');
        return null;
    }

    const colunasPeso = pesosInfo.map(p => p.value);
    const chavesPeso = pesosInfo.map(p => p.key);

    const getValorAsNumber = (chave) => {
        if (!linha[chave]) return 0;
        return parseFloat(String(linha[chave]).replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;
    };

    if (peso <= colunasPeso[0]) {
        return getValorAsNumber(chavesPeso[0]).toFixed(2);
    }

    const pesoMaximoTabela = colunasPeso[colunasPeso.length - 1];
    
    // --- LÓGICA PARA PESOS ACIMA DO MÁXIMO (COM DIAGNÓSTICO) ---
    if (peso > pesoMaximoTabela) {
        console.log(`\n--- INICIANDO DIAGNÓSTICO PARA PESO EXCEDENTE (${peso}kg) ---`);
        console.log('Colunas de peso encontradas e ordenadas:', colunasPeso);

        if (colunasPeso.length < 2) {
            console.error('!!! FALHA NO CÁLCULO: Menos de 2 colunas de peso encontradas. Não é possível calcular a taxa excedente.');
            console.log('Retornando o valor da única coluna de peso encontrada:', chavesPeso[0]);
            return getValorAsNumber(chavesPeso[0]).toFixed(2);
        }

        const penultimoPesoTabela = colunasPeso[colunasPeso.length - 2];
        const valorMaximoTabela = getValorAsNumber(chavesPeso[colunasPeso.length - 1]);
        const penultimoValorTabela = getValorAsNumber(chavesPeso[colunasPeso.length - 2]);
        
        console.log(`- Peso Máximo da Tabela: ${pesoMaximoTabela}kg (Valor: R$${valorMaximoTabela})`);
        console.log(`- Penúltimo Peso da Tabela: ${penultimoPesoTabela}kg (Valor: R$${penultimoValorTabela})`);

        const deltaPeso = pesoMaximoTabela - penultimoPesoTabela;
        const deltaValor = valorMaximoTabela - penultimoValorTabela;
        console.log(`- Diferença de Peso (Delta): ${deltaPeso}kg`);
        console.log(`- Diferença de Valor (Delta): R$${deltaValor}`);

        if (deltaPeso <= 0) {
            console.error('!!! FALHA NO CÁLCULO: Delta de Peso é zero ou negativo. As últimas colunas de peso podem ser idênticas.');
            console.log('Retornando o valor máximo da tabela como segurança.');
            return valorMaximoTabela.toFixed(2);
        }
        
        const valorKgExcedente = deltaValor / deltaPeso;
        console.log(`- Taxa por Kg Excedente: R$${valorKgExcedente.toFixed(2)}`);

        const pesoExcedente = peso - pesoMaximoTabela;
        const custoAdicional = pesoExcedente * valorKgExcedente;
        console.log(`- Peso Excedente: ${pesoExcedente}kg`);
        console.log(`- Custo Adicional Calculado: R$${custoAdicional.toFixed(2)}`);

        const valorTotal = valorMaximoTabela + custoAdicional;
        console.log(`- VALOR FINAL TOTAL: R$${valorTotal.toFixed(2)}`);
        console.log('--- FIM DO DIAGNÓSTICO ---\n');

        return valorTotal.toFixed(2);
    }

    // --- LÓGICA DE INTERPOLAÇÃO (ORIGINAL) ---
    for (let i = 0; i < colunasPeso.length - 1; i++) {
        if (peso >= colunasPeso[i] && peso <= colunasPeso[i + 1]) {
            const p1 = colunasPeso[i];
            const p2 = colunasPeso[i + 1];
            const v1 = getValorAsNumber(chavesPeso[i]);
            const v2 = getValorAsNumber(chavesPeso[i + 1]);
            
            if (p2 - p1 === 0) return v1.toFixed(2);

            const valorInterpolado = v1 + ((v2 - v1) / (p2 - p1)) * (peso - p1);
            return valorInterpolado.toFixed(2);
        }
    }

    return null;
}

// --- ROTAS ---
app.post('/consultarTodos', (req, res) => {
    try {
        const cep = (req.body.cep || '').replace(/\D/g, '');
        const peso = parseFloat(req.body.peso);
        if (!cep || isNaN(peso)) return res.json({ error: 'CEP ou peso inválido' });

        const cepNum = Number(cep);
        const cepInfo = encontrarCep(cepNum);
        if (!cepInfo) return res.json({ error: 'CEP não encontrado' });

        const origem = 'sp';
        const destino = normalizeString(cepInfo.UF);
        const tipoCep = normalizeString(cepInfo.Tipo);

        // Filtra usando as propriedades normalizadas
        const linhasDestino = fretes.filter(f =>
            f._destino === destino &&
            f._origem === origem &&
            f._classificacao === tipoCep
        );

        if (linhasDestino.length === 0) {
            return res.json({ error: `Nenhum serviço do tipo '${cepInfo.Tipo}' foi encontrado para a UF '${cepInfo.UF}'.` });
        }

        const resultado = linhasDestino.map(f => {
            const valor = calcularValorFrete(f, peso);
            return {
                servico: f._servico,
                classificacao: cepInfo.Tipo, // **CORREÇÃO**: Usa o tipo do CEP para a exibição
                valor: valor ? `R$ ${valor}` : 'Não disponível',
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

// --- Rota /consultar (mantida por compatibilidade) ---
app.post('/consultar', (req, res) => {
    try {
        const cep = (req.body.cep || '').replace(/\D/g, '');
        const peso = parseFloat(req.body.peso);
        if (!cep || isNaN(peso)) return res.json({ error: 'CEP ou peso inválido' });

        const cepNum = Number(cep);
        const cepInfo = encontrarCep(cepNum);
        if (!cepInfo) return res.json({ error: 'CEP não encontrado' });

        const origem = 'sp';
        const destino = normalizeString(cepInfo.UF);
        const tipoCep = normalizeString(cepInfo.Tipo);

        const linhaFrete = fretes.find(f => f._destino === destino && f._origem === origem && f._classificacao === tipoCep);

        if (!linhaFrete) {
            return res.json({ error: `Nenhum serviço do tipo '${cepInfo.Tipo}' disponível para este destino` });
        }

        const valorFrete = calcularValorFrete(linhaFrete, peso);

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

// --- INICIAR SERVIDOR ---
app.listen(8080, () => console.log('Servidor rodando em http://localhost:8080'));