# Vistos

Aplicativo web mobile-first para registrar vistos escolares por QR code e acompanhar notas por turma.

## Como funciona

1. O professor cria uma atividade e escolhe a turma.
2. A câmera lê o adesivo QR do aluno.
3. O backend registra no máximo um visto por aluno naquela atividade.
4. O dashboard calcula `nota = vistos recebidos ÷ atividades da turma × 10`.

O leitor oferece busca manual quando a câmera não estiver disponível, confirmação por som e vibração, desfazer imediato, tema claro/escuro e funcionamento instalável como PWA no Android.

## Privacidade

- O repositório e o GitHub Pages não contêm nomes, RAs ou tokens dos alunos.
- Os dados ficam nas propriedades privadas do projeto Apps Script.
- O QR code contém somente um token aleatório de 128 bits.
- A API exige PIN; o navegador envia apenas o hash SHA-256 e usa uma sessão temporária.
- Os arquivos `.private/` e `pdf-output/` são ignorados pelo Git.

## Estrutura

- `index.html`: leitor de QR code.
- `dashboard.html`: notas e histórico por aluno.
- `apps-script/`: backend implantado no Google Apps Script.
- `tools/`: importação das listas, configuração e geração dos PDFs.

## Desenvolvimento local

Requisitos: Node.js, `pdftotext`, uma fonte DejaVu Sans e uma sessão autenticada do `@google/clasp`.

```bash
npm install
npm run import:students
npm run generate:pdfs
npm test
```

Os PDFs são produzidos em `pdf-output/`. Imprima em A4, tamanho real (100%), sem “ajustar à página”.

## Apps Script

O projeto usa o Script ID já configurado em `.clasp.json`. Para uma instalação nova, envie o backend, crie uma implantação executável e carregue os dados:

```bash
npx @google/clasp push
npx @google/clasp deploy --description 'Vistos web app'
VISTOS_PIN='seu-pin-de-6-a-12-numeros' npm run bootstrap:appscript
```

Depois, informe a URL `/exec` da implantação em `config.js`. A implantação deve executar como o proprietário e permitir acesso anônimo; a autenticação por PIN da aplicação continua protegendo os dados. Nenhum escopo de Planilhas ou Drive é necessário.

## Licença

MIT. A biblioteca `html5-qrcode`, em `vendor/`, mantém sua própria licença Apache-2.0.
