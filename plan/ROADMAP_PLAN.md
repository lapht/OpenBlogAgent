# OpenBlogAgent — Roadmap delle prossime fasi

> Questo documento contiene le fasi successive del progetto **OpenBlogAgent**. Ogni fase è pensata per essere affrontata in una chat separata. Ogni sezione contiene il contesto necessario affinché un'AI possa comprendere lo stato del progetto senza conoscere le conversazioni precedenti.

---

# Stato attuale del progetto

## Architettura

Il progetto è una monorepo TypeScript basata su Node.js.

Utilizza:

* pnpm Workspace
* LangGraph.js
* Fastify
* Pino
* Zod
* Dependency Injection (tsyringe)
* Docker
* Vitest

L'architettura segue:

* Clean Architecture
* SOLID
* Adapter Pattern
* Strategy Pattern

---

## Componenti già implementati

* bootstrap del progetto
* configurazione centralizzata
* logging
* workflow LangGraph
* Planner Agent
* Writer Agent
* provider LLM
* Publishing Engine
* Markdown Publisher
* WordPress Publisher
* Ghost Publisher
* output Markdown

Il sistema è già in grado di:

```
Topic
↓

Planner

↓

Writer

↓

Editor

↓

SEO

↓

Publisher

↓

Output
```

---

# Fase 6 — Classification Engine

## Contesto

Dopo la generazione dell'articolo e l'ottimizzazione SEO, il contenuto deve essere classificato prima della pubblicazione.

Gli agenti non devono conoscere le piattaforme di destinazione né le loro API.

L'obiettivo è determinare automaticamente la categoria e i tag più appropriati utilizzando esclusivamente le tassonomie realmente disponibili.

---

## Obiettivo

Creare un motore di classificazione indipendente che assegni automaticamente:

* categoria
* tag

prima della fase di pubblicazione.

Il Publisher dovrà limitarsi a utilizzare queste informazioni senza prendere decisioni.

---

## Workflow

```text
Planner
    ↓
Writer
    ↓
Editor
    ↓
SEO
    ↓
Category Classifier
    ↓
Tag Generator
    ↓
Category Manager
    ↓
Tag Manager
    ↓
Quality
    ↓
Publisher
```

---

## Componenti

### Category Classifier

Responsabilità:

* analizzare il contenuto dell'articolo
* scegliere una sola categoria
* utilizzare esclusivamente categorie esistenti
* non inventare categorie

Output:

```json
{
  "category": "Artificial Intelligence"
}
```

---

### Tag Generator

Responsabilità:

* generare un insieme di tag pertinenti
* evitare duplicati
* limitare il numero massimo configurabile
* evitare tag troppo generici

Output:

```json
{
  "tags": [
    "AI",
    "Node.js",
    "LangGraph",
    "OpenRouter"
  ]
}
```

---

### Category Manager

Responsabilità:

* recuperare le categorie disponibili
* verificare che la categoria esista
* ottenere l'identificativo della categoria
* creare nuove categorie solo se consentito dalla configurazione

---

### Tag Manager

Responsabilità:

* recuperare i tag disponibili
* verificare quelli esistenti
* creare i tag mancanti (configurabile)
* restituire gli identificativi necessari al Publisher

---

## Category Provider

Introdurre una nuova interfaccia:

```text
ICategoryProvider
```

Implementazioni previste:

* WordPressCategoryProvider
* StaticCategoryProvider
* JsonCategoryProvider

In futuro potranno essere aggiunti provider per Ghost, Dev.to, Medium e altre piattaforme.

---

## Tag Provider

Introdurre:

```text
ITagProvider
```

con implementazioni analoghe al sistema delle categorie.

---

## Configurazione

Rendere configurabili almeno:

* categoria predefinita
* numero massimo di tag
* creazione automatica categorie
* creazione automatica tag
* tempo di cache delle tassonomie
* provider da utilizzare

---

## Caching

I provider devono mantenere in cache categorie e tag per evitare richieste inutili alle API delle piattaforme.

La durata della cache deve essere configurabile.

---

## Vincoli

* Il Writer non deve conoscere categorie e tag.
* Il Publisher non deve decidere categorie e tag.
* Il Classification Engine deve essere completamente indipendente dalla piattaforma di pubblicazione.
* Gli agenti devono comunicare esclusivamente tramite lo stato del workflow.

---

## Obiettivo finale

Al termine della fase, il Publisher dovrà ricevere un oggetto già completo di tutte le informazioni necessarie alla pubblicazione.

Esempio:

```json
{
  "title": "...",
  "markdown": "...",
  "categoryId": 12,
  "tagIds": [3, 8, 14]
}
```

Il Publisher dovrà limitarsi esclusivamente alla pubblicazione del contenuto, senza effettuare alcuna logica di classificazione.

---

# Fase 7 — Memory & Persistence

## Contesto

Attualmente il progetto non ricorda nulla.

Ogni workflow è completamente stateless.

## Obiettivo

Implementare il primo sistema di memoria persistente.

Utilizzare SQLite.

Non implementare ancora RAG.

## Da implementare

* database
* migrazioni
* repository
* MemoryService
* salvataggio articoli
* storico workflow
* storico prompt
* controllo duplicati

---

# Fase 8 — Research Engine

## Contesto

Attualmente il topic viene fornito manualmente.

## Obiettivo

Permettere al sistema di trovare argomenti da solo.

## Da implementare

Research Agent capace di utilizzare:

* RSS
* Web Search
* Sitemap
* Trend API
* News Feed

Output:

```
Topic Candidate

↓

Score

↓

Motivazione
```

Il Research Agent non deve ancora usare AI per tutto.

Prima raccoglie dati.

Poi li sintetizza.

---

# Fase 9 — Scheduler

## Contesto

Il workflow parte manualmente.

## Obiettivo

Automatizzare completamente il sistema.

## Da implementare

* Cron
* Job Queue
* Scheduler
* Retry
* Timeout
* Workflow History

Supportare:

* ogni ora
* ogni giorno
* ogni settimana

---

# Fase 10 — Multi Agent Workflow

## Contesto

Attualmente esistono solo Planner e Writer.

## Obiettivo

Trasformare il workflow in un vero sistema multi-agente.

Workflow previsto:

```
Research

↓

Planner

↓

Writer

↓

Editor

↓

SEO

↓

Quality

↓

Publisher
```

Ogni agente deve essere indipendente.

Gli agenti comunicano solamente tramite lo stato LangGraph.

---

# Fase 11 — Quality Engine

## Obiettivo

Valutare automaticamente ogni articolo.

## Da implementare

Calcolo punteggi:

* leggibilità
* SEO
* completezza
* lunghezza
* ripetizioni
* qualità Markdown
* struttura
* keyword coverage

Output:

```
Quality Report
```

Se il punteggio è sotto soglia:

ritornare automaticamente al Writer.

---

# Fase 12 — Human Approval

## Obiettivo

Consentire una revisione manuale.

Workflow:

```
Generate

↓

Review

↓

Approve

↓

Publish
```

Supportare:

* approvazione
* rifiuto
* modifica
* ripartenza workflow

---

# Fase 13 — Dashboard

## Obiettivo

Realizzare una dashboard web.

Visualizzare:

* workflow
* articoli
* log
* provider
* costi
* stato agenti
* cronologia
* scheduler

La dashboard non deve contenere logica AI.

---

# Fase 14 — Plugin System

## Obiettivo

Consentire agli utenti di estendere OpenBlogAgent.

Plugin possibili:

* Agent
* Provider
* Publisher
* Tool
* Workflow Node

Un plugin deve poter essere installato senza modificare il core.

---

# Fase 15 — Tool System

## Obiettivo

Centralizzare tutti gli strumenti utilizzati dagli agenti.

Tools previsti:

* Web Search
* RSS
* Markdown
* HTML Parser
* Image Search
* Image Generation
* Sitemap
* SEO
* File System

Ogni Tool implementa una interfaccia comune.

---

# Fase 16 — Multi Provider

## Obiettivo

Supportare più provider LLM.

Provider previsti:

* OpenRouter
* Ollama
* OpenAI
* Anthropic
* Google
* Azure OpenAI

Ogni agente deve poter scegliere dinamicamente il provider.

---

# Fase 17 — Cost Optimizer

## Obiettivo

Ridurre il costo dei token.

Implementare:

* cache
* model routing
* provider fallback
* retry intelligente
* modello differente per ogni agente

Esempio:

Planner

↓

Modello economico

Writer

↓

Modello più potente

Editor

↓

Modello economico

---

# Fase 18 — RAG

## Contesto

A questo punto esiste già la memoria.

## Obiettivo

Permettere agli agenti di recuperare informazioni rilevanti.

Implementare:

* embedding
* vector database
* semantic search
* retrieval
* context injection

Gli agenti non devono conoscere il vector database.

---

# Fase 19 — Analytics

## Obiettivo

Analizzare i risultati ottenuti.

Metriche:

* articoli prodotti
* tempo medio
* costo
* errori
* provider utilizzato
* performance workflow
* qualità media

---

# Fase 20 — Social Engine

## Obiettivo

Generare automaticamente contenuti social.

Output:

* LinkedIn
* X
* Facebook
* Threads
* Mastodon

Ogni post viene creato partendo dall'articolo pubblicato.

---

# Fase 21 — Image Pipeline

## Obiettivo

Gestire automaticamente le immagini.

Workflow:

```
Prompt

↓

Image Generation

↓

Compression

↓

Resize

↓

Alt Text

↓

Publisher
```

Supportare provider multipli.

---

# Fase 22 — API Pubbliche

## Obiettivo

Esporre OpenBlogAgent come piattaforma.

API previste:

* avvio workflow
* stato workflow
* recupero articoli
* recupero log
* gestione provider
* gestione scheduler
* gestione plugin

---

# Fase 23 — SDK

## Obiettivo

Consentire agli sviluppatori di creare estensioni.

Esporre:

* Agent SDK
* Tool SDK
* Publisher SDK
* Provider SDK
* Workflow SDK

---

# Fase 24 — Versione 1.0

## Checklist finale

* workflow completo
* dashboard
* plugin system
* scheduler
* memory
* RAG
* SEO
* analytics
* social
* image pipeline
* API
* SDK
* documentazione completa
* test automatici
* CI/CD
* release GitHub
* Docker
* immagini Docker pubbliche
* esempi
* template plugin
* template agent
* template publisher

---

# Filosofia del progetto

Ogni fase deve:

* essere completamente funzionante prima della successiva;
* introdurre una sola responsabilità principale;
* mantenere gli agenti indipendenti;
* evitare dipendenze circolari;
* essere facilmente testabile;
* essere pronta per diventare una Pull Request indipendente.

Ogni nuova chat con un'AI può partire direttamente da una di queste fasi, riportando il relativo contesto e l'obiettivo, senza dover ricostruire la cronologia del progetto.
