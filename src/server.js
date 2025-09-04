const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();
const PORT = 8080;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/faixas', (req, res) => {
    const results = [];
    fs.createReadStream(path.join(__dirname, 'data', 'faixas_cep_azul.csv'))
        .pipe(csv({ separator: ';' }))
        .on('data', (data) => {
            results.push({
                faixa_inicial: data['Faixa Inicial'],
                faixa_final: data['Faixa Final'],
                uf: data['UF'],
                localidade: data['Localidade'],
                preco: data['Preço']
            });
        })
        .on('end', () => {
            res.json(results);
        });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});