// Provider requests may carry message content as a plain string or as structured
// text blocks (for example, Anthropic-through-OpenRouter cacheable content). QA
// mocks route by prompt text, so they must understand both wire shapes without
// accidentally turning unknown blocks into the literal "[object Object]".
export function messageContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      return part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '';
    }).join('');
  }
  return content && typeof content === 'object' && typeof content.text === 'string' ? content.text : '';
}
