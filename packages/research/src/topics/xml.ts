import { XMLParser, XMLValidator } from "fast-xml-parser";

import { SourceFormatError } from "./types";

type XmlNode = Record<string, unknown>;

const ALWAYS_ARRAYS = new Set(["item", "entry", "link", "url", "sitemap"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: false,
  isArray: (name) => ALWAYS_ARRAYS.has(name)
});

/** Parses XML text; a document that is not well-formed throws `SourceFormatError`. */
export function parseXml(xml: string): XmlNode {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new SourceFormatError(`Malformed XML: ${valid.err.msg} (line ${valid.err.line})`);
  }
  const document = parser.parse(xml) as unknown;
  if (typeof document !== "object" || document === null) {
    throw new SourceFormatError("The document is empty");
  }
  return document as XmlNode;
}

/** The text of an element, whether it came as a string or with attributes (`#text`). */
export function textOf(node: unknown): string | undefined {
  if (typeof node === "string") {
    return node.trim() || undefined;
  }
  if (typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return textOf(node[0]);
  }
  if (typeof node === "object" && node !== null) {
    return textOf((node as XmlNode)["#text"]);
  }
  return undefined;
}

export function asArray(node: unknown): XmlNode[] {
  if (Array.isArray(node)) {
    return node.filter((entry): entry is XmlNode => typeof entry === "object" && entry !== null);
  }
  return typeof node === "object" && node !== null ? [node as XmlNode] : [];
}

export function child(node: XmlNode, name: string): unknown {
  return node[name];
}
