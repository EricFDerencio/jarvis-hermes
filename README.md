# J.A.R.V.I.S. — Hermes Agent Web Interface

Interface web estilo J.A.R.V.I.S. (Iron Man) para interagir com o Hermes Agent via API OpenAI-compatible.

## Como usar

### 1. Começar o Hermes Agent (se ainda não estiver rodando)

```bash
hermes dashboard   # inicia o dashboard web com API embutida
```

Ou inicie o proxy OpenAI-compatible:

```bash
hermes proxy       # proxy OpenAI-compatible local
```

### 2. Abrir a interface

Basta abrir o arquivo `index.html` no navegador:

```bash
# Linux (abre no navegador padrão)
xdg-open /home/derencio/Projetos/jarvis-hermes/index.html

# Ou serve via um servidor simples (recomendado para fetch CORS):
cd /home/derencio/Projetos/jarvis-hermes
python3 -m http.server 8081
```

Acesse: `http://localhost:8081`

### 3. Configurar a conexão

Na aba **Configurações**, defina o endpoint do Hermes Agent:

- `http://localhost:8080` (padrão do `hermes dashboard`)
- Ou o endpoint do `hermes proxy`

Clique em **Testar Conexão** para verificar.

## Funcionalidades

- **Terminal**: Chat conversacional com o Hermes Agent
- **Histórico**: Sessões anteriores (placeholder)
- **Configurações**: Endpoint, modelo, temperatura
- **Status**: Estado da conexão, tokens
- **Skills**: Lista de skills carregados do Hermes
- **Voz**: Reconhecimento de voz via Web Speech API (se disponível)
- **Tema**: Escuro estilo J.A.R.V.I.S. com scanlines e grid

## Personalização

As configurações são salvas automaticamente no `localStorage` do navegador.

## Estrutura

```
/home/derencio/Projetos/jarvis-hermes/
└── index.html       # Interface completa (HTML + CSS + JS)
```

Arquivo único — basta abrir no navegador.
