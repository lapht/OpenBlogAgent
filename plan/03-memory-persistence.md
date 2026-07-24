# Memory & Persistence

## Contesto
SEO e Classification sono completati. Workflow: Research(manuale)->Planner->Writer->SEO->Classification->Publisher.

## Obiettivo
Introdurre memoria persistente con SQLite, Repository Pattern e MemoryService senza accoppiare gli agenti al database.

## Implementare
- SQLite
- Migrazioni
- ArticleRepository
- PromptRepository
- WorkflowRepository
- TopicRepository
- MemoryService
- Duplicate detection

## Vincoli
Gli agenti non accedono mai direttamente al DB.

## Criterio di completamento
Ogni workflow viene salvato e i topic duplicati vengono rilevati.
