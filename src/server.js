const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();
const PORT = 8080;

app.use(express.static(path.join(__dirname, 'public')));

// Função para buscar faixa de CEP
function buscarFaixa(cep, callback) {
    const results = [];
    fs.createReadStream(path.join(__dirname, 'data', 'faixas_cep_azul.csv'))
        .pipe(csv({ separator: ',' }))
        .on('data', (data) => {
            // Converte para número
            const faixaInicial = parseInt(data['CEP Inicial']);
            const faixaFinal = parseInt(data['CEP Final']);
            if (cep >= faixaInicial && cep <= faixaFinal) {
                results.push({
                    uf: data['UF'],
                    cidade: data['Cidade'],
                    tipo: data['Tipo'],
                    prazo: Number(data['Prazo']),
                    preco: Number(data['Preço'])
                });
            }
        })
        .on('end', () => {
            callback(results.length > 0 ? results[0] : null);
        });
}

// Rota para calcular frete
app.get('/api/calcular', (req, res) => {
    const cep = parseInt(req.query.cep);
    const peso = parseFloat(req.query.peso);
    const precoProduto = parseFloat(req.query.preco);

    if (isNaN(cep) || isNaN(peso) || isNaN(precoProduto)) {
        return res.json({ error: 'Parâmetros inválidos.' });
    }

    buscarFaixa(cep, (faixa) => {
        if (!faixa) {
            return res.json({ error: 'CEP não encontrado na tabela Azul Cargo.' });
        }

        // Exemplo de cálculo de frete (ajuste conforme sua regra)
        let frete = faixa.preco * peso;

        res.json({
            uf: faixa.uf,
            cidade: faixa.cidade,
            tipo: faixa.tipo,
            prazo: faixa.prazo,
            frete: frete
        });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});