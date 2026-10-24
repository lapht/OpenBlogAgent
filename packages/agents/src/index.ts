export * from "./classification/agent";
export * from "./structured-output";
export * from "./quality";
export * from "./planner/agent";
export * from "./writer/agent";
export * from "./prompts/overrides";
export { referencesHeading, type SourceNote } from "./prompts/sources";
export { urlIdentity } from "./quality/validate-article";
export * from "./review/agent";

// Re-export agent factories for convenience
export {
  createEditorAgent,
  type EditorAgent,
  type EditorAgentInput,
  type EditorOutput,
  editorOutputSchema
} from "./editor/agent";
export {
  createSeoAgent,
  type SeoAgent,
  type SeoAgentInput,
  type SeoOutput,
  seoOutputSchema
} from "./seo/agent";
export {
  createResearchAgent,
  topicIdeaSchema,
  type ResearchAgent,
  type TopicIdea,
  type TopicIdeaInput
} from "./research/agent";
export {
  selectRelatedArticles,
  type InternalLink,
  type PublishedArticle,
  type RelatedQuery
} from "./links/related";
