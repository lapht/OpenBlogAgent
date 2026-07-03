# OpenBlogAgent -- Roadmap

## Obiettivo

Realizzare un sistema di agenti AI che generi, ottimizzi e pubblichi
automaticamente articoli per un blog.

## Fase 1 -- Fondamenta

-   [ ] Repository GitHub
-   [ ] Licenza MIT
-   [ ] TypeScript + Node.js
-   [ ] Docker
-   [ ] Configurazione `.env`
-   [ ] Logging
-   [ ] SQLite

## Fase 2 -- Core

-   [ ] LangGraph.js
-   [ ] Orchestratore
-   [ ] Sistema memoria
-   [ ] Adapter LLM
-   [ ] Adapter OpenRouter
-   [ ] Adapter Ollama

## Fase 3 -- Agenti

-   [ ] Scheduler
-   [ ] Trend Researcher
-   [ ] Keyword Researcher
-   [ ] Content Planner
-   [ ] Writer
-   [ ] Fact Checker
-   [ ] Editor
-   [ ] SEO Optimizer
-   [ ] Image Generator
-   [ ] Image Optimizer
-   [ ] Internal Linker
-   [ ] Tag & Category Manager
-   [ ] Publisher
-   [ ] Social Writer
-   [ ] Analytics Agent
-   [ ] Memory Agent

## Fase 4 -- Storage

-   [ ] Articoli
-   [ ] Memoria
-   [ ] Cronologia prompt
-   [ ] Cache

## Fase 5 -- Publishing

-   [ ] WordPress
-   [ ] Ghost
-   [ ] Markdown
-   [ ] API REST

## Fase 6 -- Dashboard

-   [ ] Stato workflow
-   [ ] Costi token
-   [ ] Cron
-   [ ] Log
-   [ ] Retry
-   [ ] Human Approval

## Fase 7 -- Qualità

-   [ ] SEO score
-   [ ] Duplicate detection
-   [ ] Link checker
-   [ ] JSON-LD
-   [ ] FAQ
-   [ ] A/B Titoli

## Fase 8 -- Extra

-   [ ] Plugin system
-   [ ] MCP
-   [ ] Multi-lingua
-   [ ] RSS Import
-   [ ] Newsletter
-   [ ] Podcast script
-   [ ] RAG sugli articoli
-   [ ] Test automatici
-   [ ] CI/CD GitHub Actions

## Struttura

    src/
      agents/
      graph/
      providers/
      storage/
      publishers/
      tools/
      prompts/
      config/
      api/
      dashboard/

## MVP

1.  Ricerca argomento
2.  Piano articolo
3.  Scrittura
4.  SEO
5.  Immagine
6.  Pubblicazione Markdown
7.  Pubblicazione WordPress

## Versione 1.0

-   Plugin
-   Dashboard
-   MCP
-   RAG
-   Analytics
-   Multi-provider
