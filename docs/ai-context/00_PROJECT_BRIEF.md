# OpenBlogAgent — Project Brief

## 1. Project vision

OpenBlogAgent is an open-source software project intended to automate an editorial workflow using AI.

The long-term goal is to build a reliable system capable of researching topics, planning and generating articles, validating content, improving editorial quality, managing SEO, handling images, and publishing content through external publishing platforms.

WordPress is the primary known publishing target. Markdown publishing has also been part of the original scope.

The goal is not merely to generate text using an LLM. The goal is to build a maintainable, testable, observable, extensible and reliable software system that can execute an editorial workflow from research to publication.

## 2. Current project status

The repository contains work produced iteratively with AI coding tools, including free or low-cost models.

The implementation may contain incomplete features, inconsistent abstractions, incorrect assumptions, duplicated logic, weak tests, fragile integrations, architectural debt or code that does not work end to end.

Do not assume that existing functionality is correct simply because it exists in the repository.

Do not assume that the entire codebase is unusable either. Evaluate each component based on evidence.

The actual implementation status must be established by inspecting the repository, configuration, dependencies, tests and available execution paths.

## 3. Freedom to redesign

The existing implementation is not sacred.

You are explicitly allowed to recommend:

- Refactoring existing code.
- Replacing flawed abstractions.
- Reorganizing package boundaries.
- Reconsidering framework and dependency choices.
- Rewriting individual modules.
- Rewriting the application architecture if the current architecture is fundamentally unsuitable.
- Rebuilding the application incrementally from a clean foundation if that offers a better result.

Do not recommend a rewrite merely because a different design looks cleaner. Compare the benefits, risks, cost and migration strategy against a targeted refactor.

Preserve useful work where it has demonstrable value. Do not preserve bad work merely to avoid admitting that it was bad.

## 4. Engineering quality goals

The desired result should have:

- Clear architecture and separation of responsibilities.
- Explicit and understandable module boundaries.
- Strong TypeScript typing and validation at external boundaries.
- Predictable error handling and recovery from failures.
- Meaningful automated tests.
- Reliable provider and publishing integrations.
- Structured logging and useful diagnostics.
- Reproducible local development and deployment.
- Secure handling of configuration and secrets.
- Controlled costs when using LLM providers.
- Documentation that accurately reflects the implementation.
- A practical, incremental path toward a working end-to-end product.

Apply Clean Architecture, SOLID, dependency injection and design patterns where they solve actual problems. Do not introduce abstractions simply to satisfy architectural fashion.

## 5. AI provider and cost constraints

Cost matters. Prefer low-cost or free development and testing approaches when they are appropriate.

However, low cost must not justify unreliable behavior, missing tests, fabricated results or an architecture tied unnecessarily to one provider.

Provider choices must be evaluated against actual requirements, current availability, quality, latency, operational complexity and cost.

Avoid adding paid services or subscriptions without a clear justification.

## 6. Product quality and publication safety

Content generation alone is not sufficient.

The system should be designed to assess whether generated content satisfies explicit quality criteria before publication.

Consider factual correctness, completeness, structure, readability, SEO, duplication, link validity, failure recovery and appropriate human review.

Publishing must have clear, testable rules. Failed validation must not silently result in publication.

The precise evaluation criteria, thresholds and publication policies should be determined from the repository and product requirements rather than assumed to have already been implemented.

## 7. Planning expectations

The immediate objective is to establish the actual condition of the repository and produce a realistic GitHub implementation backlog.

The backlog must cover all material work necessary to reach a reliable, maintainable and functioning product, including foundational repairs and substantial redesign where justified.

Organize work into milestones ordered by dependencies and risk.

Every implementation issue should have a clear problem statement, a bounded scope, acceptance criteria, relevant technical evidence and appropriate testing requirements.

Prefer independently reviewable changes. Do not split work into meaningless micro-issues or combine unrelated changes into enormous issues.

The immediate deliverable is a validated implementation plan expressed as GitHub milestones and issues. Do not start modifying application code as part of the planning exercise.

## 8. Decision-making principles

Prioritize correctness, maintainability, reliability and a functioning end-to-end workflow over preserving previous AI-generated code.

Distinguish verified facts from assumptions.

Do not claim that code works unless there is supporting evidence.

Do not silently turn historical ideas into mandatory product requirements.

When a decision materially affects architecture, scope, cost or security, explain the trade-offs and record the decision clearly.
