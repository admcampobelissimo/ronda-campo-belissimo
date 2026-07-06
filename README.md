# Ronda • Condomínio Campo Belíssimo

App web (PWA) para checklist diário de ronda das áreas comuns: foto tirada na hora (sem galeria), carimbo de data/hora, observações e relatório em PDF compartilhável.

## Testar agora no computador

1. Instale a extensão/preview ou rode um servidor estático simples nesta pasta (já existe `serve.ps1` pronto: `powershell -File serve.ps1`).
2. Abra `http://localhost:8080` no navegador.

## Colocar no ar para testar no celular (obrigatório: HTTPS)

Câmera, PWA "instalar app" e o botão "Compartilhar" só funcionam em conexão segura (https) ou localhost. Forma mais rápida, sem precisar de conta:

1. Acesse **https://app.netlify.com/drop** no computador.
2. Arraste esta pasta inteira (`CLAUDE BELISSIMO`) para a página.
3. Em segundos você recebe um link `https://algumnome.netlify.app`.
4. Abra esse link no Chrome do Android → menu (⋮) → **"Adicionar à tela inicial"** para instalar como app.

(Alternativas equivalentes: GitHub Pages, Vercel — qualquer hospedagem de arquivo estático serve, não precisa de servidor/backend.)

## O que já foi implementado

- Tela de identificação: nome do colaborador, equipe e turno.
- Checklist com as áreas organizadas por setor (ver `areas.js`), com progresso e retomada automática se o app for fechado no meio da ronda.
- Botão de câmera por área: abre a câmera do celular diretamente (`capture="environment"`), sem opção de galeria.
- Cada foto recebe automaticamente um carimbo com nome da área + data/hora no próprio rodapé da imagem.
- Campo de observação opcional por área.
- Geração de relatório em PDF (capa com colaborador/equipe/turno/data, lista de pendências, e cada área com foto + horário + observação).
- Botão "Compartilhar" (abre o menu nativo de compartilhamento do Android — WhatsApp, e-mail, Drive etc.) e "Baixar PDF" como alternativa.
- Instalável como ícone na tela inicial do Android (PWA), com ícone e cores do condomínio.

## Observações / decisões tomadas

- Nos dados enviados havia duas entradas "Torre Figueira" (uma com Academia/Sala de Ginástica, outra com os halls). Foram **unificadas em um único grupo "Torre Figueira"** com as 5 áreas. Se a intenção era manter a Academia como categoria separada, é só avisar que ajusto em `areas.js`.
- Não existe login/senha — o app pede apenas nome, equipe e turno a cada ronda. Se depois vocês quiserem restringir por senha simples ou lista fixa de colaboradores, dá para adicionar.
- O carimbo de data/hora usa o relógio do celular no momento em que a foto é processada pelo app (não o metadado EXIF da câmera, que os navegadores costumam remover). Isso já garante o registro "em tempo real" pedido.
- Sobre "impedir 100% o envio de foto da galeria": o atributo usado (`capture="environment"`) faz o Chrome Android abrir a câmera diretamente na grande maioria dos aparelhos — mas por ser web (não um app nativo instalado via loja), não existe garantia absoluta em 100% dos navegadores/fabricantes. Se isso for crítico, o caminho é empacotar este mesmo código com **Capacitor** e usar o plugin de Câmera nativo (aí sim é garantido). O app já está pronto para essa migração futura sem precisar refazer nada.
- Progresso e observações ficam salvos no aparelho (localStorage/IndexedDB) até a ronda ser finalizada — se o colaborador fechar o navegador no meio, ao reabrir ele retoma de onde parou.

## Estrutura de arquivos

```
index.html        tela principal
styles.css        visual (azul marinho + dourado)
app.js            toda a lógica (câmera, carimbo, PDF, compartilhamento)
areas.js          lista das áreas por setor — editar aqui para adicionar/remover áreas
manifest.webmanifest / sw.js   PWA (instalar como app, funcionar offline)
assets/           logo e ícones do condomínio
vendor/           biblioteca jsPDF (local, não depende de internet após o 1º carregamento)
```
