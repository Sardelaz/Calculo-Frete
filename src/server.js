    const express = require('express');
    const path = require('path');
    const fs = require('fs');
    const csv = require('csv-parser');

    const app = express();
    const PORT = 8080;

    app.use(express.static(path.join(__dirname, 'public')));

    // Função para organizar tarifas
    function parseTarifasCSV(callback) {
        const tarifas = [];
        const pesos = [
            "0,25","0,5","0,75","1,0","1,5","2,0","2,5","3,0","3,5","4,0","4,5","5,0",
            "6,0","7,0","8,0","9,0","10,0","11,0","12,0","13,0","14,0","15,0",
            "16,0","17,0","18,0","19,0","20,0","21,0","22,0","23,0","24,0","25,0",
            "26,0","27,0","28,0","29,0","30,0"
        ];

        let primeiraLinha = true;

        fs.createReadStream(path.join(__dirname, 'data', 'csv - SHATARK  - SP - ECM.csv'))
            .pipe(csv({ separator: ';' }))
            .on('data', (data) => {
                if (primeiraLinha) { primeiraLinha = false; return; }
                if (!data['ORIGEM'] || !data['DESTINO'] || !data['CLASSIFICAÇÃO']) return;

                const faixa = {
                    origem: data['ORIGEM'].trim(),
                    destino: data['DESTINO'].trim(),
                    classificacao: data['CLASSIFICAÇÃO'].trim(),
                    servico: data['SERVIÇO'] ? data['SERVIÇO'].trim() : '',
                    precos: {},
                    adicional: parseFloat((data['ADD'] || '0').replace(',', '.')) || 0
                };

                pesos.forEach(peso => {
                    const key = peso.replace(',', '.');
                    faixa.precos[key] = parseFloat((data[peso] || '0').replace(',', '.'));
                });

                tarifas.push(faixa);
            })
            .on('end', () => callback(tarifas));
    }

    // Função para buscar faixa de CEP
    function buscarFaixa(cep, callback) {
        const results = [];
        fs.createReadStream(path.join(__dirname, 'data', 'faixas_cep_azul.csv'))
            .pipe(csv({ separator: ',' }))
            .on('data', (data) => {
                const faixaInicial = parseInt(data['CEP Inicial'].replace(/\D/g, ''));
                const faixaFinal = parseInt(data['CEP Final'].replace(/\D/g, ''));
                if (cep >= faixaInicial && cep <= faixaFinal) {
                    results.push({
                        uf: data['UF'].trim(),
                        cidade: data['Cidade'].trim(),
                        tipo: data['Tipo'].trim(), // Capital, Redespacho ou Interior
                        prazo: Number(data['Prazo'])
                    });
                }
            })
            .on('end', () => callback(results.length > 0 ? results[0] : null));
    }

    // Rota para calcular frete e mostrar informações
    app.get('/api/calcular', (req, res) => {
        const cepInput = String(req.query.cep || '').replace(/\D/g, '');
        const pesoInput = String(req.query.peso || '').replace(',', '.');

        const cep = parseInt(cepInput, 10);
        const peso = parseFloat(pesoInput);

        if (!cepInput || cepInput.length !== 8 || isNaN(cep) || isNaN(peso) || peso <= 0) {
            return res.json({ error: 'Parâmetros inválidos.' });
        }

        buscarFaixa(cep, (faixa) => {
            if (!faixa) return res.json({ error: 'CEP não encontrado na tabela Azul Cargo.' });

            parseTarifasCSV((tarifas) => {

                // Normaliza UF e Tipo
                const ufBusca = faixa.uf.trim().toLowerCase();
                const tipoBusca = faixa.tipo.trim().toLowerCase();

                const tarifa = tarifas.find(t => 
                    t.destino.trim().toLowerCase() === ufBusca &&
                    t.classificacao.trim().toLowerCase() === tipoBusca
                );

                if (!tarifa) {
                    console.log('Não encontrou tarifa. Buscando:', ufBusca, tipoBusca);
                    tarifas.forEach(t => console.log(t.destino, t.classificacao));
                    return res.json({ error: 'Tarifa não encontrada para destino e tipo.' });
                }

                const pesosDisponiveis = Object.keys(tarifa.precos).map(p => parseFloat(p));
                const maxPeso = Math.max(...pesosDisponiveis);

                let freteFinal = 0;
                let faixaPeso = null;

                if (peso <= maxPeso) {
                    faixaPeso = pesosDisponiveis.filter(p => p >= peso).sort((a, b) => a - b)[0];
                    freteFinal = (tarifa.precos[faixaPeso.toFixed(1)] || 0) + tarifa.adicional;
                } else {
                    const valorBase = tarifa.precos[maxPeso.toFixed(1)] || 0;
                    const excedente = peso - maxPeso;
                    const adicionalKg = tarifa.adicional > 0 ? tarifa.adicional : (valorBase / maxPeso);
                    freteFinal = valorBase + (excedente * adicionalKg);
                    faixaPeso = `>${maxPeso}`;
                }

                res.json({
                    uf: faixa.uf,
                    cidade: faixa.cidade,
                    tipo: faixa.tipo,
                    prazo: faixa.prazo,
                    peso: peso,
                    faixaPeso: faixaPeso,
                    frete: freteFinal.toFixed(2)
                });
            });
        });
    });

    app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
