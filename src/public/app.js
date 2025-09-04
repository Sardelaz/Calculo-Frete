document.getElementById('frete-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const cep = document.getElementById('cep').value;
    const peso = document.getElementById('peso').value;
    const preco = document.getElementById('preco').value;

    fetch(`/api/calcular?cep=${cep}&peso=${peso}&preco=${preco}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                document.getElementById('resultado').innerHTML = `<span style="color:red">${data.error}</span>`;
            } else {
                document.getElementById('resultado').innerHTML = `
                    <strong>Estado (UF):</strong> ${data.uf}<br>
                    <strong>Cidade:</strong> ${data.localidade}<br>
                    <strong>Capital/Interior:</strong> ${data.tipo}<br>
                    <strong>Tempo de entrega:</strong> ${data.tempo_entrega} dias<br>
                    <strong>Frete:</strong> R$ ${data.frete.toFixed(2)}
                `;
            }
        })
        .catch(() => {
            document.getElementById('resultado').innerHTML = `<span style="color:red">Erro ao calcular frete.</span>`;
        });
});